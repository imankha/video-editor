import json
import msgpack


def encode_data(data) -> bytes | None:
    if data is None:
        return None
    return msgpack.packb(data, use_bin_type=True)


def decode_data(raw):
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        return json.loads(raw) if raw else None
    if len(raw) == 0:
        return None
    return msgpack.unpackb(raw, raw=False)
