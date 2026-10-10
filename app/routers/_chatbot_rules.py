CHATBOT_RULES = [
    {
        "keywords": ["hello", "hi ", "hey", "help me", "what can you do"],
        "response": "Welcome to TripWise!\n\nI can help with:\n- Sign in / sign up\n- Book a trip\n- Manage / cancel bookings\n- Write reviews\n- Set preferences\n- Get recommendations\n\nTry: 'how do I login' or 'how to book a trip'."
    },
    {
        "keywords": ["login", "sign in", "signin"],
        "response": "To sign in:\n1. Click 'Sign in' at top-right.\n2. Enter email and password.\n3. Click 'Sign in'."
    },
    {
        "keywords": ["register", "signup", "sign up", "create account"],
        "response": "To create an account:\n1. Click 'Create account'.\n2. Fill name, email, phone.\n3. Choose password (6+ chars).\n4. Submit."
    },
    {
        "keywords": ["how to book", "book a trip", "book flight", "make a booking"],
        "response": "How to book:\n1. Sign in.\n2. Click any Destination card.\n3. Set dates, passengers, cabin.\n4. Continue to payment."
    },
    {
        "keywords": ["cancel booking", "how to cancel"],
        "response": "To cancel: My Bookings → find the pending booking → Cancel."
    },
    {
        "keywords": ["nearby", "places to visit", "attractions"],
        "response": "Click any destination card to see nearby places on a map and add them to your booking."
    },
    {
        "keywords": ["payment", "pay", "cost", "price"],
        "response": "Payment is by QR code. Total = flight + stay + activities."
    },
    {
        "keywords": ["destination", "where to go", "countries"],
        "response": "TripWise has destinations across Asia, Europe, Americas, Africa, Oceania. Filter with chips or search."
    },
    {
        "keywords": ["thanks", "thank you"],
        "response": "You're welcome!"
    },
]


def rule_based_reply(message: str) -> str:
    msg = (message or "").lower().strip()
    if not msg:
        return "Please ask a question about TripWise."
    best, best_score = None, 0
    for rule in CHATBOT_RULES:
        s = sum(len(kw) for kw in rule["keywords"] if kw in msg)
        if s > best_score:
            best_score, best = s, rule
    if best:
        return best["response"]
    return "I can help with TripWise: login, booking, cancellation, reviews, destinations. Try 'how to book'."