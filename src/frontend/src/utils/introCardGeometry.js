// GENERATED FROM app/services/intro_card_geometry.py — do not hand-edit.
// Regenerate: cd src/backend && .venv/Scripts/python.exe -m app.services.intro_card_geometry
// Parity is enforced by src/backend/tests/test_t5210_geometry_parity.py.
//
// Shared intro-card slot geometry + motion timing + treatment palette (T5210).
// See the Python module for the coordinate convention, the ordinal-geometry /
// semantic-styling mapping, and rationale. The editor (T5205) reads THESE numbers
// so its live preview + motion + treatment swatches match the render engine.

export const CARD_ASPECTS = /* @parity:aspects:start */ {
  "landscape": "16:9",
  "portrait": "9:16"
} /* @parity:aspects:end */;

export const INTRO_CARD_GEOMETRY = /* @parity:geometry:start */ {
  "broadcast": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.048,
          "x": 0.06,
          "y": 0.82
        },
        "fact2": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.048,
          "x": 0.06,
          "y": 0.89
        },
        "subtitle": {
          "align": "left",
          "maxWidth": 0.55,
          "size": 0.045,
          "x": 0.06,
          "y": 0.75
        },
        "title": {
          "align": "left",
          "maxWidth": 0.6,
          "size": 0.11,
          "x": 0.06,
          "y": 0.62
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.03,
          "x": 0.5,
          "y": 0.79
        },
        "fact2": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.03,
          "x": 0.5,
          "y": 0.845
        },
        "subtitle": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.028,
          "x": 0.5,
          "y": 0.735
        },
        "title": {
          "align": "center",
          "maxWidth": 0.9,
          "size": 0.062,
          "x": 0.5,
          "y": 0.66
        }
      }
    }
  },
  "hero": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "left",
          "maxWidth": 0.55,
          "size": 0.055,
          "x": 0.06,
          "y": 0.865
        },
        "subtitle": {
          "align": "left",
          "maxWidth": 0.55,
          "size": 0.05,
          "x": 0.06,
          "y": 0.8
        },
        "title": {
          "align": "left",
          "maxWidth": 0.62,
          "size": 0.12,
          "x": 0.06,
          "y": 0.66
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.034,
          "x": 0.5,
          "y": 0.84
        },
        "subtitle": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.03,
          "x": 0.5,
          "y": 0.795
        },
        "title": {
          "align": "center",
          "maxWidth": 0.9,
          "size": 0.066,
          "x": 0.5,
          "y": 0.72
        }
      }
    }
  },
  "recruiting": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 0.46,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.05,
          "x": 0.52,
          "y": 0.46
        },
        "fact2": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.05,
          "x": 0.52,
          "y": 0.6
        },
        "fact3": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.05,
          "x": 0.52,
          "y": 0.74
        },
        "subtitle": {
          "align": "left",
          "maxWidth": 0.42,
          "size": 0.042,
          "x": 0.52,
          "y": 0.33
        },
        "title": {
          "align": "left",
          "maxWidth": 0.44,
          "size": 0.095,
          "x": 0.52,
          "y": 0.2
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 0.56,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "fact1": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.032,
          "x": 0.5,
          "y": 0.72
        },
        "fact2": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.032,
          "x": 0.5,
          "y": 0.79
        },
        "fact3": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.032,
          "x": 0.5,
          "y": 0.86
        },
        "subtitle": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.028,
          "x": 0.5,
          "y": 0.665
        },
        "title": {
          "align": "center",
          "maxWidth": 0.9,
          "size": 0.058,
          "x": 0.5,
          "y": 0.6
        }
      }
    }
  },
  "title-only": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "subtitle": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.06,
          "x": 0.5,
          "y": 0.6
        },
        "title": {
          "align": "center",
          "maxWidth": 0.86,
          "size": 0.135,
          "x": 0.5,
          "y": 0.38
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "slots": {
        "subtitle": {
          "align": "center",
          "maxWidth": 0.8,
          "size": 0.034,
          "x": 0.5,
          "y": 0.5
        },
        "title": {
          "align": "center",
          "maxWidth": 0.86,
          "size": 0.072,
          "x": 0.5,
          "y": 0.4
        }
      }
    }
  }
} /* @parity:geometry:end */;

export const INTRO_CARD_TREATMENTS = /* @parity:treatments:start */ {
  "dark": {
    "accent": "#e5e7eb",
    "background": {
      "center": [
        0.5,
        0.0
      ],
      "css": "radial-gradient(120% 120% at 50% 0%, #1a2230 0%, #05070b 70%)",
      "extent": [
        1.2,
        1.2
      ],
      "stops": [
        {
          "color": "#1a2230",
          "pos": 0.0
        },
        {
          "color": "#05070b",
          "pos": 0.7
        }
      ],
      "type": "radial"
    }
  },
  "gold": {
    "accent": "#f7e28b",
    "background": {
      "center": [
        0.5,
        0.0
      ],
      "css": "radial-gradient(120% 120% at 50% 0%, #2a2410 0%, #0d0b06 70%)",
      "extent": [
        1.2,
        1.2
      ],
      "stops": [
        {
          "color": "#2a2410",
          "pos": 0.0
        },
        {
          "color": "#0d0b06",
          "pos": 0.7
        }
      ],
      "type": "radial"
    }
  },
  "photo-forward": {
    "accent": "#ffffff",
    "background": {
      "color": "#04060a",
      "css": "#04060a",
      "type": "solid"
    }
  }
} /* @parity:treatments:end */;

export const INTRO_CARD_MOTION = /* @parity:motion:start */ {
  "flashOutD": 0.22,
  "photoPushInZoomEnd": 1.12,
  "photoPushInZoomStart": 1.0,
  "textFadeD": 0.45,
  "textRiseFrac": 0.02,
  "textStaggerFirstSt": 0.35,
  "textStaggerStep": 0.16
} /* @parity:motion:end */;

export const STAGGER_ORDER = /* @parity:staggerOrder:start */ ["title", "subtitle", "fact1", "fact2", "fact3"] /* @parity:staggerOrder:end */;

/**
 * Resolve an output frame size to its contract aspect key. Mirrors
 * `intro_card_geometry.aspect_key` on the backend (landscape/square -> 16:9).
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function aspectKey(width, height) {
  return width >= height ? CARD_ASPECTS.landscape : CARD_ASPECTS.portrait;
}

/**
 * `{photo, slots}` for a composition + aspect key. Throws on an unknown key
 * (a drift bug, never a silent fallback) to match the Python accessor.
 * @param {string} composition one of COMPOSITION.* (introCardComposition.js)
 * @param {string} aspect one of CARD_ASPECTS.*
 */
export function geometryFor(composition, aspect) {
  const byAspect = INTRO_CARD_GEOMETRY[composition];
  const geo = byAspect && byAspect[aspect];
  if (!geo) {
    throw new Error(
      `no intro card geometry for composition=${composition} aspect=${aspect}`
    );
  }
  return geo;
}

/**
 * `{background, accent}` for a treatment key. Throws on an unknown key.
 * @param {string} treatment one of TREATMENTS (introCardComposition.js)
 */
export function treatmentFor(treatment) {
  const t = INTRO_CARD_TREATMENTS[treatment];
  if (!t) {
    throw new Error(`unknown treatment=${treatment}`);
  }
  return t;
}
