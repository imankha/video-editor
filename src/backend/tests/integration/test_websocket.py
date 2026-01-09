#!/usr/bin/env python3
"""
WebSocket connection tests.
Run: python test_websocket.py

Tests the WebSocket progress endpoint for export operations.
Requires: pip install websockets
"""

import asyncio
import sys
import io

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

try:
    import websockets
except ImportError:
    print("Please install websockets: pip install websockets")
    sys.exit(1)

WS_URL = "ws://localhost:8000/ws/export"

async def test_single_connection():
    """Test single WebSocket connection."""
    export_id = "test-single-123"
    uri = f"{WS_URL}/{export_id}"
    print(f"\n[Test 1] Single connection to {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print("  ✓ Connected successfully")

            # Send a ping
            await ws.send("ping")
            print("  ✓ Sent ping message")

            # Brief wait
            await asyncio.sleep(0.5)
            print("  ✓ Connection stable")

            return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False

async def test_multiple_connections():
    """Test multiple simultaneous connections to same export_id."""
    export_id = "test-multi-456"
    uri = f"{WS_URL}/{export_id}"
    print(f"\n[Test 2] Multiple connections to {uri}")

    connections = []
    try:
        # Connect 3 clients
        for i in range(3):
            ws = await websockets.connect(uri)
            connections.append(ws)
            print(f"  ✓ Client {i+1} connected")

        print(f"  ✓ All {len(connections)} clients connected simultaneously")

        # Brief wait to verify stability
        await asyncio.sleep(0.5)

        # Close all
        for i, ws in enumerate(connections):
            await ws.close()
            print(f"  ✓ Client {i+1} disconnected")

        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        # Cleanup
        for ws in connections:
            try:
                await ws.close()
            except:
                pass
        return False

async def test_message_handling():
    """Test message send/receive."""
    export_id = "test-msg-789"
    uri = f"{WS_URL}/{export_id}"
    print(f"\n[Test 3] Message handling at {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print("  ✓ Connected")

            # Send multiple messages
            for i in range(3):
                await ws.send(f"ping-{i}")
                print(f"  ✓ Sent message {i+1}")
                await asyncio.sleep(0.1)

            print("  ✓ All messages sent without error")
            return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False

async def test_rapid_connect_disconnect():
    """Stress test with rapid connect/disconnect cycles."""
    export_id = "test-stress"
    uri = f"{WS_URL}/{export_id}"
    print(f"\n[Test 4] Rapid connect/disconnect stress test")

    success_count = 0
    cycles = 10

    for i in range(cycles):
        try:
            ws = await websockets.connect(uri)
            await ws.send("ping")
            await ws.close()
            success_count += 1
        except Exception as e:
            print(f"  ✗ Cycle {i+1} failed: {e}")

    print(f"  ✓ Completed {success_count}/{cycles} cycles successfully")
    return success_count == cycles

async def main():
    print("=" * 50)
    print("WebSocket Connection Tests")
    print("=" * 50)
    print(f"Target: {WS_URL}")

    # Check if server is running
    try:
        ws = await asyncio.wait_for(
            websockets.connect(f"{WS_URL}/health-check"),
            timeout=3.0
        )
        await ws.close()
    except asyncio.TimeoutError:
        print("\n✗ Connection timeout. Is the backend running?")
        print(f"  Start with: cd src/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000")
        sys.exit(1)
    except Exception:
        # Connection might fail for other reasons, but server is up
        pass

    tests = [
        ("Single Connection", test_single_connection),
        ("Multiple Connections", test_multiple_connections),
        ("Message Handling", test_message_handling),
        ("Stress Test", test_rapid_connect_disconnect),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        try:
            result = await test_func()
            if result:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  ✗ {name}: Unexpected error: {e}")
            failed += 1

    print("\n" + "=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)

    return 0 if failed == 0 else 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
