output "load_balancer_ip" { value = google_compute_global_address.platform.address }
output "hostnames" { value = local.hosts }
output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
