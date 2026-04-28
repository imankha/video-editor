import json

import msgpack


def encode_data(data) -> bytes | None:
    if data is None:
        return None
    return msgpack.packb(data, use_bin_type=True)


def decode_data(raw: bytes | str | None):
    if raw is None:
        return None
    if isinstance(raw, str):
        return json.loads(raw)
    if len(raw) == 0:
        return None
    if raw[0:1] in (b'{', b'['):
        return json.loads(raw)
    return msgpack.unpackb(raw, raw=False)
