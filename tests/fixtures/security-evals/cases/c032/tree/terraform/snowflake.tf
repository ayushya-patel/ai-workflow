resource "snowflake_user" "etl" {
  name         = "ETL_SERVICE"
  login_name   = "etl_service"
  password     = var.etl_password
  default_role = "ACCOUNTADMIN"
}

resource "snowflake_grant_account_role" "etl_admin" {
  role_name = "ACCOUNTADMIN"
  user_name = snowflake_user.etl.name
}
