output "instance_connection_name" {
  # value     = "postgresql+pg8000://${google_sql_user.user.name}:${random_password.password.result}@${google_sql_database_instance.instance.public_ip_address}:5432/${google_sql_database.db.name}"
  value = google_sql_database_instance.instance.connection_name
}

output "password" {
  value     = random_password.password.result
  sensitive = true
}

output "username" {
  value = google_sql_user.user.name
}

output "client_cert" {
  value     = google_sql_ssl_cert.postgres_client_cert.cert
  sensitive = true
}

output "server_cert" {
  value     = google_sql_database_instance.instance.server_ca_cert[0].cert
  sensitive = true
}

output "client_key" {
  value     = google_sql_ssl_cert.postgres_client_cert.private_key
  sensitive = true
}
