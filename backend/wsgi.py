"""WSGI entry point. `gunicorn wsgi:app` in production, `python wsgi.py` in dev."""
from app import create_app

app = create_app()

if __name__ == "__main__":
    from app.config import config

    app.run(host="127.0.0.1", port=5000, debug=config.is_development)
