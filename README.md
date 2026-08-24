# NEXUS — AI Assistant Website

A marketing site for a fictional AI assistant product ("NEXUS"), built for the WEB技術 I course. The frontend is static HTML/CSS/JS; the backend is a Python Flask server that adds real functionality on top: an AI chatbot, account signup/login, test-mode payment checkout, and a working contact form.

## Features

- **Marketing pages** — Home, Features, Pricing, About Us, all in English by default with a Japanese toggle (top-right of the header), a cinematic scroll-driven hero, and animated page sections.
- **AI chatbot** — a chat widget on every page (bottom-right). Answers using Google's Gemini API if configured, otherwise falls back to a built-in rule-based responder — so it always works, even with no API key.
- **Accounts** — `signup.html` / `login.html`, backed by a local SQLite database. Passwords are hashed (never stored in plain text). The header nav shows who's logged in and swaps to a "Log Out" link automatically.
- **Payments (test mode)** — the Pro plan on the Pricing page can be "purchased" through Stripe Checkout or PayPal, both running in sandbox/test mode by default (no real money moves).
- **Contact form** — the form on the About Us page emails the site owner directly via SMTP (Gmail), if configured.

## Tech stack

- **Frontend:** plain HTML, CSS, and vanilla JavaScript (no framework, no build step)
- **Backend:** Python 3 + [Flask](https://flask.palletsprojects.com/)
- **Database:** SQLite (a single local file, `nexus.db`, created automatically on first run)
- **External APIs (all optional):** Google Gemini (chatbot), Stripe (payments), PayPal (payments), Gmail SMTP (contact form)

## Project structure

```
nexus-ai-site/
├── server.py            # Flask backend — routes, chatbot, auth, payments, email
├── requirements.txt      # Python dependencies
├── .env.example           # Template for your own .env (see Setup below)
├── nexus.db               # SQLite database (auto-created, not in git)
│
├── index.html              # Home page
├── features.html          # Features page
├── pricing.html            # Pricing page (checkout is here)
├── about_us.html          # About Us + Contact form
├── login.html               # Log in page
├── signup.html             # Sign up page
│
├── style.css                # All site styling
├── motion.js                # Shared JS: scroll effects, language toggle, nav auth state
├── translations.js         # English/Japanese text dictionary
│
└── *.svg, *.png             # Images (skyline art, chat preview screenshot)
```

## Prerequisites

- **Python 3.10+** — check with `python --version`. If that command doesn't show a real version number, Python isn't properly on your PATH; use the full path to your `python.exe` instead (see Troubleshooting below).
- **pip** (comes with Python)

No Node.js, no database server, and no other software is required — SQLite is built into Python.

## Setup

1. **Open a terminal in this folder** (`nexus-ai-site/`).

2. **Install the Python dependencies:**

   ```
   pip install -r requirements.txt
   ```

3. **Create your `.env` file** by copying the template:

   ```
   copy .env.example .env
   ```
   (On macOS/Linux: `cp .env.example .env`)

4. **Generate a `SECRET_KEY`** (required — this signs login session cookies) and paste it into `.env`:

   ```
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   Everything else in `.env` is **optional** — the site runs fine without any of it, just with those specific features turned off gracefully (see the table below).

5. **Run the server:**

   ```
   python server.py
   ```

6. **Open the site:** [http://localhost:5000](http://localhost:5000)

## Environment variables (`.env`)

| Variable | Required? | What it does if missing |
|---|---|---|
| `SECRET_KEY` | **Yes** | Without it, login sessions won't work reliably (a random key is used as a fallback, but everyone gets logged out every time the server restarts). |
| `GEMINI_API_KEY` | No | Chatbot falls back to a built-in rule-based responder — still fully functional, just less flexible. |
| `STRIPE_SECRET_KEY` | No | The "Pay with card" button on the Pricing page shows a friendly "not configured" message instead of starting checkout. |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | No | The PayPal button shows the same "not configured" message. |
| `SMTP_USERNAME` / `SMTP_PASSWORD` / `CONTACT_EMAIL_TO` | No | The Contact form shows "not set up yet" instead of silently failing. |

Full instructions and links for getting each key are already written as comments inside `.env.example`.

**Never commit your real `.env` file** — it's already listed in `.gitignore`. Only `.env.example` (with placeholder values) belongs in version control.

## API endpoints (backend routes)

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves `index.html` |
| `/chat` | POST | Chatbot — `{"question": "..."}` → `{"answer": "..."}` |
| `/signup` | POST | Creates an account, logs the user in |
| `/login` | POST | Verifies credentials, logs the user in |
| `/logout` | POST | Ends the session |
| `/me` | GET | `{"loggedIn": true/false, "name": "..."}` — used by the header nav |
| `/contact` | POST | Sends the About Us contact form by email |
| `/payment-config` | GET | Tells the frontend which payment methods are available |
| `/create-checkout-session` | POST | Starts a Stripe Checkout session (test mode) |
| `/paypal/create-order` / `/paypal/capture-order/<id>` | POST | PayPal Sandbox order flow |

## Database

A single SQLite file, `nexus.db`, is created automatically the first time you run `server.py`. It has one table, `users` (id, name, email, password_hash, created_at). Passwords are hashed with Werkzeug's `generate_password_hash` — the plain-text password is never stored.

To reset all accounts, just delete `nexus.db` and restart the server; a fresh empty database will be created.

## Troubleshooting

- **`python --version` prints nothing useful / commands silently fail on Windows** — this usually means `python` on your PATH points to the Microsoft Store's placeholder app instead of a real install. Find your real Python with `where python` (check every path it lists) and call that one directly, e.g. `C:\Users\<you>\AppData\Local\Python\bin\python.exe server.py`.
- **SSL certificate errors when the chatbot or payments try to reach an external API** — some Windows setups (often behind school/corporate networks or antivirus) can't verify certificates through Python's bundled cert store. Fix: `pip install pip-system-certs` (already in `requirements.txt`), which makes Python use Windows' own trusted certificate store instead.
- **Chatbot/payments/contact form all show "not configured" messages** — that's expected and by design if you haven't filled in the optional keys in `.env`. The site still works end-to-end without them.

## Notes

- Payments run in **test/sandbox mode only** by default — no real money is ever charged with the setup described here. Test Stripe payments with the card number `4242 4242 4242 4242` (any future expiry date, any CVC).
- This project was built as coursework and is not a production deployment — the built-in Flask server (`app.run(debug=True)`) is for local development only.
