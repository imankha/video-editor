import msgpack


def encode_data(data) -> bytes | None:
    if data is None:
        return None
    return msgpack.packb(data, use_bin_type=True)


def decode_data(raw):
    if raw is None:
        return None
    if isinstance(raw, memoryview):
        raw = bytes(raw)
    if isinstance(raw, bytes):
        return msgpack.unpackb(raw, raw=False) if raw else None
    raise TypeError(f"decode_data expects bytes, got {type(raw).__name__}")
