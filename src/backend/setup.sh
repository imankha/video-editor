#!/bin/bash
# Backend Setup Script for Linux/macOS
# Run this script from the backend directory: ./setup.sh

echo "Setting up Video Editor Backend..."

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
python -m pip install --upgrade pip

# Install requirements
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Verify installation
echo ""
echo "Verifying installation..."
python -c "import fastapi; import uvicorn; import multipart; print('✓ All dependencies installed successfully!')"

echo ""
echo "✓ Setup complete!"
echo ""
echo "To start the server, run:"
echo "  source .venv/bin/activate"
echo "  python -m uvicorn app.main:app --reload"
echo ""
echo "Note: Make sure FFmpeg is installed on your system"
echo "  Ubuntu/Debian: sudo apt-get install ffmpeg"
echo "  macOS: brew install ffmpeg"
