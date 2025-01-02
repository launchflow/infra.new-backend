variable "cpu" {
  type = number
}

variable "memory" {
  type = number
}

resource "google_sql_database_instance" "my-db" {
  name             = "my-database"
  region           = "us-central1"
  database_version = "POSTGRES_9_6"

  settings {
    tier = "db-custom-${var.cpu + 1}-${var.memory}"
    ip_configuration {
      ipv4_enabled = true
    }
  }
}
