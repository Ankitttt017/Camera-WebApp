"""Mitsubishi SLMP (3E binary) single-bit read, shared by the PLC monitor and the hierarchy "Test PLC" button."""
import socket


def slmp_read_m_bit(host: str, port: int, device: str, address: int | str, timeout: float = 3.0) -> bool:
    device_codes = {
        'M': 0x90,
        'X': 0x9C,
        'Y': 0x9D,
        'L': 0x92,
        'F': 0x93,
        'B': 0xA0,
    }
    device_text = device.upper()
    device_code = device_codes.get(device_text)
    if device_code is None:
        raise ValueError(f'Unsupported SLMP device: {device}')
    address_text = str(address).strip().upper()
    if address_text.startswith(device_text):
        address_text = address_text[len(device_text):]
    address_number = int(address_text, 16) if device_text in {'X', 'Y'} else int(address_text, 10)

    payload = (
        (0x0010).to_bytes(2, 'little')
        + (0x0401).to_bytes(2, 'little')
        + (0x0001).to_bytes(2, 'little')
        + address_number.to_bytes(3, 'little')
        + bytes([device_code])
        + (1).to_bytes(2, 'little')
    )
    frame = (
        b'\x50\x00'
        + b'\x00'
        + b'\xff'
        + b'\xff\x03'
        + b'\x00'
        + len(payload).to_bytes(2, 'little')
        + payload
    )

    response = None
    last_err = None
    port_int = int(port)

    # 1. Try UDP first if port is in standard UDP SLMP port range (5000-5003)
    if port_int in {5000, 5001, 5002, 5003, 5004}:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.settimeout(timeout)
                sock.sendto(frame, (host, port_int))
                response, _ = sock.recvfrom(1024)
        except Exception as udp_err:
            last_err = udp_err
            response = None

    # 2. Try TCP
    if response is None:
        try:
            with socket.create_connection((host, port_int), timeout=timeout) as sock:
                sock.settimeout(timeout)
                sock.sendall(frame)
                response = sock.recv(1024)
        except Exception as tcp_err:
            last_err = tcp_err
            # 3. Fallback to UDP if TCP fails
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                    sock.settimeout(timeout)
                    sock.sendto(frame, (host, port_int))
                    response, _ = sock.recvfrom(1024)
            except Exception:
                raise last_err

    if len(response) < 11:
        raise RuntimeError(f'SLMP short response for {device}{address}: {response.hex(" ")}')
    end_code = int.from_bytes(response[9:11], 'little')
    if end_code != 0:
        raise RuntimeError(f'SLMP error for {device}{address}: 0x{end_code:04X}')
    data = response[11:]
    if not data:
        raise RuntimeError(f'SLMP no data for {device}{address}')
    # SLMP 3E binary (0401/0001): 1-point bit read response.
    # The requested bit (point 1) is returned in the UPPER nibble (bits 4-7).
    # The lower nibble (bits 0-3) is 0-padded for odd/1-point reads.
    # Bit ON: data[0] == 0x10 -> ((0x10 >> 4) & 0x0F) == 1 -> True
    # Bit OFF: data[0] == 0x00 -> ((0x00 >> 4) & 0x0F) == 0 -> False
    return bool((data[0] >> 4) & 0x0F)
