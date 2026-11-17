"""Blueprint registration."""
from .alerts import bp as alerts_bp
from .auth import bp as auth_bp
from .boletos import bp as boletos_bp
from .cheques import bp as cheques_bp
from .clients import bp as clients_bp
from .dashboard import bp as dashboard_bp
from .operations import bp as operations_bp
from .receipts import bp as receipts_bp
from .reports import bp as reports_bp
from .settings import bp as settings_bp
from .users import bp as users_bp


def register_blueprints(app):
    for blueprint in (
        alerts_bp,
        auth_bp,
        users_bp,
        clients_bp,
        cheques_bp,
        boletos_bp,
        operations_bp,
        receipts_bp,
        reports_bp,
        dashboard_bp,
        settings_bp,
    ):
        app.register_blueprint(blueprint)
