"""WSGI entry point.

Development:  flask --app wsgi run --debug
Production:   waitress-serve --port=8000 wsgi:app
"""
from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
