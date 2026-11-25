def test_seed_does_not_log_initial_password_in_production_mode(app):
    app.config.update(
        DEBUG=False,
        ADMIN_EMAIL="deploy-admin@test.com",
        ADMIN_PASSWORD="DeploySecret123!",
    )

    result = app.test_cli_runner().invoke(args=["seed"])

    assert result.exit_code == 0, result.output
    assert "DeploySecret123!" not in result.output
    assert "não exibida nos logs" in result.output
