# Bro please pay 🧾✨

An AI-powered bill splitting application where hosts upload restaurant bills, AI parses them into line items, and friends join real-time sessions to claim their items with instant UPI payment generation.

## 🎯 Features

- **AI Bill Parsing**: Upload a photo of any restaurant bill, and Gemini 1.5 Flash extracts items, quantities, and prices
- **Smart QR Onboarding**: Scan your GPay/PhonePe QR code once, never type your UPI ID again
- **Real-Time Claiming**: Tap items to claim them, see friends' avatars appear live
- **Proportional Tax Split**: Tax and service charges are automatically distributed fairly
- **Instant UPI Payment**: One tap to pay the host directly via UPI deep links

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** (App Router)
- **Tailwind CSS** (Dark mode themed)
- **Supabase** (Auth + Realtime + Storage)
- **TypeScript**

### Backend
- **FastAPI** (Python)
- **Google Gemini 1.5 Flash** (Vision AI for bill parsing)
- **Supabase** (PostgreSQL Database)
- **OpenCV + pyzbar** (QR code detection)

## 📁 Project Structure

```
BIll/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example           # Environment variables template
│   └── routers/
│       ├── scan.py            # QR code scanning endpoint
│       └── bills.py           # Bill parsing endpoint
├── frontend/
│   ├── app/
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Landing page
│   │   ├── onboard/           # QR code onboarding
│   │   ├── host/              # Bill upload & parsing
│   │   ├── join/              # Join bill by ID
│   │   └── bill/[id]/         # Real-time splitting interface
│   ├── lib/
│   │   ├── supabase.ts        # Supabase client
│   │   ├── calculations.ts    # Bill splitting logic
│   │   └── upi.ts             # UPI payment generation
│   ├── package.json
│   └── .env.local.example
└── supabase/
    └── schema.sql             # Database schema with RLS policies
```

## 🚀 Setup Instructions

### 1. Prerequisites
- Node.js 18+ and npm
- Python 3.9+
- Supabase account ([supabase.com](https://supabase.com))
- Google Gemini API key ([Google AI Studio](https://makersuite.google.com/app/apikey))

### 2. Database Setup

1. Create a new Supabase project
2. Run the schema:
   ```bash
   # Copy the contents of supabase/schema.sql and run in Supabase SQL Editor
   ```
3. Enable Realtime for all tables:
   - Go to Database → Replication
   - Enable replication for: `bills`, `bill_items`, `participants`, `claims`

### 3. Backend Setup

```bash
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
# source venv/bin/activate

# Install dependencies (FastAPI, Uvicorn, HTTPX)
python -m pip install -r requirements.txt

# Configure environment
copy .env.example .env
# Edit .env with your credentials:
# - SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY
# - GEMINI_API_KEY

# Run server
python main.py
```

**Note:** The backend has been optimized to run without heavy dependencies (no Supabase SDK or Gemini SDK required). It uses direct HTTP calls for maximum compatibility.

Backend will run on `http://localhost:8000`

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
copy .env.local.example .env.local
# Edit .env.local with:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - NEXT_PUBLIC_API_URL=http://localhost:8000

# Run development server
npm run dev
```

Frontend will run on `http://localhost:3000`

## 🎮 Usage

### As a Host:
1. Sign in → "Host a Bill"
2. Upload bill image (photo or screenshot)
3. AI parses items automatically
4. Share the bill link with friends
5. Track who claims what in real-time
6. Receive payments via UPI

### As a Friend:
1. Sign in → "Join a Bill" or click shared link
2. See all bill items
3. Tap items you ordered
4. View your total (with proportional tax)
5. Pay host directly via UPI

### Setting Up UPI:
1. Go to "Set up UPI payment"
2. Upload screenshot of your GPay/PhonePe QR code
3. AI extracts your UPI VPA automatically
4. Save profile

## 🔐 Security Features

- Row Level Security (RLS) on all tables
- Users can only see bills they're part of
- Host-only permissions for bill creation
- JWT-based authentication via Supabase

## 🧪 Testing

### Backend API:
```bash. Health check
curl http://localhost:8000/health

# Test QR scanning
curl -X POST http://localhost:8000/api/scan-qr \
  -F "file=@qr_code.jpg"

# Test bill parsing
curl -X POST http://localhost:8000/api/parse-bill \
  -F "file=@bill.jpg" \
  -F "host_id=your-user-id"
```

### Frontend:
```bash
npm run build  # Check for TypeScript errors
npm run lint   # Check linting
```

## 📱 Mobile Testing

**UPI payments only work on mobile devices!** To test:
1. Deploy frontend to Vercel/Netlify
2. Open on your phone
3. Test payment flow end-to-end

## 🎨 Design Philosophy

- **Dark Mode First**: Sleek zinc-950 background inspired by "Dark" series
- **Emerald Accents**: Money-related actions use emerald-500
- **Glass Morphism**: Subtle frosted glass effects
- **Micro-animations**: Smooth transitions for better UX

## 🤝 Contributing

This is a demo project. Feel free to fork and customize!

## 📄 License

MIT License - feel free to use this for your own projects!

---

**Built with ❤️ using Next.js, FastAPI, and Google Gemini AI**
