resource "google_sql_database_instance" "instance" {
  name             = "infra-new-instance"
  database_version = "POSTGRES_15"
  region           = "us-central1"
  project          = var.gcp_project_id

  settings {
    tier = "db-custom-2-3840"
    ip_configuration {
      ipv4_enabled    = true
      ssl_mode        = "ENCRYPTED_ONLY"
      private_network = var.private_network
    }
  }
}

resource "random_password" "password" {
  length  = 16
  special = false
}

resource "google_sql_user" "user" {
  name     = "infa-new-user"
  instance = google_sql_database_instance.instance.name
  password = random_password.password.result
  project  = var.gcp_project_id
}

resource "google_sql_database" "db" {
  name     = "infra-new-database"
  instance = google_sql_database_instance.instance.name
  project  = var.gcp_project_id
}

resource "google_sql_ssl_cert" "postgres_client_cert" {
  common_name = "postgres_common_name"
  instance    = google_sql_database_instance.instance.name
  project     = var.gcp_project_id
}

resource "google_project_service" "servicenetworking_api" {
  service = "sqladmin.googleapis.com"
  project = var.gcp_project_id

  disable_on_destroy = false
}
