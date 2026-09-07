import { describe, it, expect, vi, afterEach } from 'vitest';

// T8838: unit-test the shrink-capability census in isolation. mp4box is mocked so a
// controllable "moov parse" drives each scenario; WebCodecs is faked on globalThis.
let mp4boxScenario = null; // (fileObj) => void, run inside flush()
vi.mock('mp4box', () => ({
  default: {
    createFile: () => {
      const f = {
        onReady: null,
        onError: null,
        appendBuffer() {},
        flush() {
          if (mp4boxScenario) mp4boxScenario(f);
        },
      };
      return f;
    },
  },
}));

import {
  deriveCodecFamily,
  deriveResBucket,
  probeShrinkCapability,
  probeAndReport,
  BEACON_PROBE_TOTAL,
  BEACON_PROBE_FAILED,
} from './shrinkCapability';

// A file whose slices resolve instantly — the census never reads mdat, so byte
// content is irrelevant; only the faststart ranges + mp4box scenario matter.
function fakeFile() {
  return { slice: () => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) };
}
const FASTSTART = { ftypOffset: 0, ftypSize: 8, moovOffset: 8, moovSize: 100 };

// Scenario helpers.
function readyWith(codec, width, height) {
  return (f) => f.onReady({ videoTracks: [{ codec, video: { width, height } }] });
}
function parseError() {
  return (f) => f.onError('bad moov');
}

// WebCodecs fakes.
function installWebCodecs({ decode, encode }) {
  if (decode === undefined) {
    delete globalThis.VideoDecoder;
  } else {
    globalThis.VideoDecoder = {
      isConfigSupported: decode === 'throw'
        ? () => Promise.reject(new Error('bad config'))
        : () => Promise.resolve({ supported: decode }),
    };
  }
  if (encode === undefined) {
    delete globalThis.VideoEncoder;
  } else {
    globalThis.VideoEncoder = {
      isConfigSupported: encode === 'throw'
        ? () => Promise.reject(new Error('bad config'))
        : () => Promise.resolve({ supported: encode }),
    };
  }
}

afterEach(() => {
  mp4boxScenario = null;
  delete globalThis.VideoDecoder;
  delete globalThis.VideoEncoder;
});

describe('deriveCodecFamily (real codec strings)', () => {
  it.each([
    ['hvc1.2.4.H156.b0', 'hevc10'], // real DJI 8K 10-bit
    ['hvc1.1.6.L153.b0', 'hevc8'],  // Main 8-bit
    ['hev1.2.4.L120.b0', 'hevc10'],
    ['avc1.640028', 'avc'],         // real Legends file
    ['avc1.4d001f', 'avc'],
    ['avc3.640033', 'avc'],
    ['av01.0.08M.10', 'av1'],
    ['vp09.00.10.08', 'vp9'],
    ['vp9', 'vp9'],
    ['hvc1.3.1.L90.b0', 'other'],   // uncounted HEVC profile
    ['mp4v.20.9', 'other'],
    ['', 'other'],
    [null, 'other'],
  ])('%s -> %s', (codec, family) => {
    expect(deriveCodecFamily(codec)).toBe(family);
  });
});

describe('deriveResBucket (coded height)', () => {
  it.each([
    [720, 'le1080'],
    [1080, 'le1080'],
    [1440, 'le4k'],
    [2160, 'le4k'],
    [2161, 'gt4k'],
    [4320, 'gt4k'], // 8K
  ])('height %d -> %s', (h, bucket) => {
    expect(deriveResBucket(h)).toBe(bucket);
  });
});

describe('probeShrinkCapability', () => {
  it('reports the real DJI file as hevc10/gt4k with decode+encode yes', async () => {
    mp4boxScenario = readyWith('hvc1.2.4.H156.b0', 7680, 4320);
    installWebCodecs({ decode: true, encode: true });
    const r = await probeShrinkCapability(fakeFile(), FASTSTART);
    expect(r).toMatchObject({
      decode: 'yes',
      encode: 'yes',
      codecFamily: 'hevc10',
      resBucket: 'gt4k',
      codec: 'hvc1.2.4.H156.b0',
    });
  });

  it('passes the EXACT mp4box codec string to VideoDecoder.isConfigSupported', async () => {
    mp4boxScenario = readyWith('hvc1.2.4.H156.b0', 7680, 4320);
    const spy = vi.fn(() => Promise.resolve({ supported: true }));
    globalThis.VideoDecoder = { isConfigSupported: spy };
    globalThis.VideoEncoder = { isConfigSupported: () => Promise.resolve({ supported: true }) };
    await probeShrinkCapability(fakeFile(), FASTSTART);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ codec: 'hvc1.2.4.H156.b0', codedWidth: 7680, codedHeight: 4320 }),
    );
  });

  it('maps decode=false to "no"', async () => {
    mp4boxScenario = readyWith('avc1.640028', 1920, 1080);
    installWebCodecs({ decode: false, encode: true });
    const r = await probeShrinkCapability(fakeFile(), FASTSTART);
    expect(r.decode).toBe('no');
    expect(r.codecFamily).toBe('avc');
    expect(r.resBucket).toBe('le1080');
  });

  it('reports "unavailable" when WebCodecs is absent (Firefox/old Safari)', async () => {
    mp4boxScenario = readyWith('avc1.640028', 3840, 2160);
    installWebCodecs({ decode: undefined, encode: undefined });
    const r = await probeShrinkCapability(fakeFile(), FASTSTART);
    expect(r.decode).toBe('unavailable');
    expect(r.encode).toBe('unavailable');
  });

  it('counts a thrown isConfigSupported as "no", never a throw', async () => {
    mp4boxScenario = readyWith('avc1.640028', 1920, 1080);
    installWebCodecs({ decode: 'throw', encode: 'throw' });
    const r = await probeShrinkCapability(fakeFile(), FASTSTART);
    expect(r.decode).toBe('no');
    expect(r.encode).toBe('no');
  });

  it('rejects when mp4box cannot parse the moov', async () => {
    mp4boxScenario = parseError();
    installWebCodecs({ decode: true, encode: true });
    await expect(probeShrinkCapability(fakeFile(), FASTSTART)).rejects.toThrow();
  });
});

describe('probeAndReport beacon contract', () => {
  it('emits exactly 3 beacons on success: total + decode + encode', async () => {
    mp4boxScenario = readyWith('hvc1.2.4.H156.b0', 7680, 4320);
    installWebCodecs({ decode: true, encode: true });
    const report = vi.fn();
    await probeAndReport(fakeFile(), FASTSTART, report);
    expect(report.mock.calls.map((c) => c[0])).toEqual([
      BEACON_PROBE_TOTAL,
      'shrink_decode_yes_hevc10_gt4k',
      'shrink_encode_yes',
    ]);
  });

  it('names the decode beacon by outcome/family/bucket for a 1080p AVC no-decode', async () => {
    mp4boxScenario = readyWith('avc1.640028', 1920, 1080);
    installWebCodecs({ decode: false, encode: true });
    const report = vi.fn();
    await probeAndReport(fakeFile(), FASTSTART, report);
    expect(report.mock.calls.map((c) => c[0])).toEqual([
      BEACON_PROBE_TOTAL,
      'shrink_decode_no_avc_le1080',
      'shrink_encode_yes',
    ]);
  });

  it('emits ONLY shrink_probe_failed on a parse failure (never more)', async () => {
    mp4boxScenario = parseError();
    installWebCodecs({ decode: true, encode: true });
    const report = vi.fn();
    await probeAndReport(fakeFile(), FASTSTART, report);
    expect(report.mock.calls.map((c) => c[0])).toEqual([BEACON_PROBE_FAILED]);
  });

  it('emits probe_failed when the faststart byte range is missing', async () => {
    // no-moov / fragmented / tiny-file faststart results carry moovSize=0.
    installWebCodecs({ decode: true, encode: true });
    const report = vi.fn();
    await probeAndReport(fakeFile(), { ftypSize: 0, moovSize: 0 }, report);
    expect(report.mock.calls.map((c) => c[0])).toEqual([BEACON_PROBE_FAILED]);
  });

  it('NEVER throws — even if the reporter itself throws', async () => {
    mp4boxScenario = readyWith('avc1.640028', 1920, 1080);
    installWebCodecs({ decode: true, encode: true });
    const report = vi.fn(() => { throw new Error('transport blew up'); });
    await expect(probeAndReport(fakeFile(), FASTSTART, report)).resolves.toBeUndefined();
  });

  it('NEVER throws with no reporter supplied', async () => {
    mp4boxScenario = readyWith('avc1.640028', 1920, 1080);
    installWebCodecs({ decode: true, encode: true });
    await expect(probeAndReport(fakeFile(), FASTSTART)).resolves.toBeUndefined();
  });
});
