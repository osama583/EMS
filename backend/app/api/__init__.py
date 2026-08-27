"""Blueprint registry. One module per resource family, all mounted under /api/v1."""
from __future__ import annotations

from .admin import bp as admin_bp
from .auth import bp as auth_bp
from .cafeterias import bp as cafeterias_bp
from .catalog import bp as catalog_bp
from .clubs import bp as clubs_bp, categories_bp as club_categories_bp
from .dashboard import bp as dashboard_bp
from .events import bp as events_bp
from .options import bp as options_bp
from .proposals import bp as proposals_bp
from .tasks import bp as tasks_bp, orders_bp as cafeteria_orders_bp
from .uploads import bp as uploads_bp

BLUEPRINTS = (
    auth_bp,
    proposals_bp,
    tasks_bp,
    cafeteria_orders_bp,
    # Before catalog_bp: both mount under /catalog/cafeterias, and the more
    # specific resource must match first.
    cafeterias_bp,
    catalog_bp,
    options_bp,
    admin_bp,
    dashboard_bp,
    events_bp,
    clubs_bp,
    club_categories_bp,
    uploads_bp,
)
