# Hello World - Full Stack Demo

This is a simple "Hello World" application that demonstrates all technologies in our stack working together.

## 🎯 What This Demonstrates

- ✅ **React** - Frontend UI framework
- ✅ **Vite** - Build tool and dev server
- ✅ **Tailwind CSS** - Utility-first styling
- ✅ **FastAPI** - Python backend framework
- ✅ **Axios** - HTTP client for API calls
- ✅ **CORS** - Cross-origin communication
- ✅ **Async/Await** - Modern JavaScript and Python

## 🚀 Quick Start (5 minutes)

### Step 1: Set Up Backend

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the backend
./run.sh
# OR manually:
# uvicorn app.main:app --reload
```

Backend will be running at **http://localhost:8000**

### Step 2: Set Up Frontend (in a new terminal)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Run the dev server
npm run dev
```

Frontend will be running at **http://localhost:5173**

### Step 3: View the App

Open your browser to **http://localhost:5173**

You should see:
- ✅ Beautiful gradient background (Tailwind CSS)
- ✅ Tech stack cards (React components)
- ✅ Live data from the backend (FastAPI + Axios)
- ✅ Success message with timestamp
- ✅ Backend tech stack details

## 🔍 What to Check

### Backend is Working
1. Visit **http://localhost:8000** - Should see API info
2. Visit **http://localhost:8000/docs** - Interactive API documentation (Swagger UI)
3. Visit **http://localhost:8000/api/hello** - Raw JSON response

### Frontend is Working
1. Visit **http://localhost:5173** - Main app
2. Check browser console - Should see no errors
3. Green checkmark should appear with "Hello from FastAPI + Python!"

### Integration is Working
- If you see the green success message with timestamp, **everything is connected!** ✅
- If you see a red error, make sure backend is running on port 8000

## 📁 Project Structure

```
video-editor/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py          # FastAPI app
│   ├── requirements.txt      # Python dependencies
│   └── run.sh               # Run script
│
└── frontend/
    ├── src/
    │   ├── App.jsx          # Main React component
    │   ├── main.jsx         # Entry point
    │   └── index.css        # Tailwind CSS
    ├── index.html
    ├── package.json         # Node dependencies
    ├── vite.config.js       # Vite configuration
    ├── tailwind.config.js   # Tailwind configuration
    └── postcss.config.js    # PostCSS configuration
```

## 🎨 Technologies Explained

### Frontend Stack

**React 18**
- Component-based UI library
- Hooks (useState, useEffect) for state management
- See it in action: The entire `App.jsx` is a React component

**Vite**
- Super fast dev server with hot module replacement (HMR)
- When you save a file, the browser updates instantly
- Try it: Edit the title in `App.jsx` and watch it update!

**Tailwind CSS**
- Utility-first CSS framework
- Classes like `bg-gradient-to-br`, `text-white`, `rounded-lg`
- See it in action: All the styling in `App.jsx`

**Axios**
- HTTP client for making API requests
- See it in action: The `useEffect` hook fetches data from `/api/hello`

### Backend Stack

**FastAPI**
- Modern Python web framework
- Automatic API documentation
- Fast performance with async support

**Python 3.11+**
- Backend programming language
- Type hints with Pydantic for data validation

**Uvicorn**
- ASGI server that runs the FastAPI app
- Supports async/await

## 🧪 Testing the Connection

### Manual Test

1. **Backend only**: Open http://localhost:8000/api/hello
   - You should see JSON data

2. **Frontend only**: The app should show a loading spinner if backend is off

3. **Both together**: The app should display the success message

### CORS Test

The frontend (localhost:5173) talks to the backend (localhost:8000). This requires CORS to be configured, which we've done in `backend/app/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    ...
)
```

## 🎯 What's Next?

Now that you have the basic stack working:

1. **Explore the code**
   - Read through `frontend/src/App.jsx`
   - Read through `backend/app/main.py`
   - Understand how they communicate

2. **Try modifying it**
   - Change the message in the backend
   - Add more styling with Tailwind
   - Add another API endpoint

3. **Move to the real project**
   - Follow `IMPLEMENTATION_PLAN.md` for Phase 1
   - Build the video upload feature
   - Add the video player

## 🐛 Troubleshooting

### Backend won't start
- Check Python version: `python3 --version` (need 3.11+)
- Make sure virtual environment is activated
- Try installing dependencies again

### Frontend won't start
- Check Node version: `node --version` (need 18+)
- Delete `node_modules` and run `npm install` again
- Check for port conflicts on 5173

### CORS errors in browser console
- Make sure backend is running
- Check that CORS origins match in `backend/app/main.py`

### Can't see the success message
- Open browser DevTools (F12) and check Console tab
- Check Network tab to see if the API call is happening
- Make sure both servers are running

## 📚 Useful Commands

### Backend
```bash
# Start backend
cd backend
source venv/bin/activate
./run.sh

# View logs
# Uvicorn shows logs in the terminal

# Stop backend
# Ctrl+C
```

### Frontend
```bash
# Start frontend
cd frontend
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Stop frontend
# Ctrl+C
```

## ✨ Success Criteria

You know everything is working when:
- ✅ Backend shows "Application startup complete" in terminal
- ✅ Frontend shows "VITE v5.x.x ready" in terminal
- ✅ Browser shows the app at localhost:5173
- ✅ Green success message appears with current timestamp
- ✅ No errors in browser console
- ✅ Tech stack details are displayed

**Congratulations! Your full stack is working!** 🎉

Now you're ready to build the actual video editor application.
