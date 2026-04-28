import msgpack


def encode_data(data) -> bytes | None:
    if data is None:
        return None
    return msgpack.packb(data, use_bin_type=True)


def decode_data(raw: bytes | None):
    if raw is None:
        return None
    if len(raw) == 0:
        return None
    return msgpack.unpackb(raw, raw=False)
