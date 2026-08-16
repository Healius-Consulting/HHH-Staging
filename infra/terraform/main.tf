locals {
  hosts = {
    public = "www.${var.base_domain}"
    portal = "portal.${var.base_domain}"
  }
  escaped_base_domain = replace(var.base_domain, ".", "\\.")
  services = {
    public = { image = var.images.public, account = "public-web", host = local.hosts.public }
    portal = { image = var.images.portal, account = "portal-web", host = local.hosts.portal }
    api    = { image = var.images.api, account = "platform-api", host = "" }
  }
  apis = toset([
    "artifactregistry.googleapis.com", "compute.googleapis.com", "firestore.googleapis.com",
    "iam.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com", "run.googleapis.com",
    "secretmanager.googleapis.com", "identitytoolkit.googleapis.com"
  ])
}

resource "google_identity_platform_config" "staff_identity" {
  project            = var.project_id
  authorized_domains = concat(values(local.hosts), var.additional_auth_domains)
  lifecycle { prevent_destroy = true }

  sign_in {
    email {
      enabled           = true
      password_required = true
    }
    anonymous { enabled = false }
  }

  client {
    permissions {
      disabled_user_signup   = true
      disabled_user_deletion = true
    }
  }

  mfa {
    provider_configs {
      state = "MANDATORY"
      totp_provider_config { adjacent_intervals = 1 }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_project_service" "required" {
  for_each           = local.apis
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "hhh-platform"
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  for_each     = local.services
  account_id   = each.value.account
  display_name = "HHH ${each.key} Cloud Run runtime"
}

resource "google_secret_manager_secret" "ip_hash" {
  secret_id = var.ip_hash_secret_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "api_ip_hash" {
  for_each  = toset(["api", "portal"])
  secret_id = google_secret_manager_secret.ip_hash.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "datastore" {
  for_each = toset(["portal", "api"])
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "firebase_auth_api" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_project_iam_member" "firebase_auth_gateway" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.runtime["portal"].email}"
}

resource "google_project_iam_member" "integration_secret_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_cloud_run_v2_service" "service" {
  for_each             = local.services
  name                 = "hhh-${each.key}"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  launch_stage         = "BETA"
  default_uri_disabled = true
  deletion_protection  = true

  scaling {
    min_instance_count = var.min_instances
    max_instance_count = var.max_instances
  }

  template {
    service_account = google_service_account.runtime[each.key].email
    timeout         = each.key == "api" ? "60s" : "15s"
    containers {
      image = each.value.image
      ports { container_port = 8080 }
      resources { limits = { cpu = "1", memory = each.key == "api" ? "1Gi" : "512Mi" } }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      dynamic "env" {
        for_each = each.key == "api" ? {
          AUTH_MODE             = "cookie-enforced"
          PORTAL_APP_ORIGIN     = "https://${local.hosts.portal}"
          PUBLIC_APP_ORIGIN     = "https://${local.hosts.public}"
          APP_BASE_URL          = "https://${local.hosts.portal}"
          ALLOWED_ORIGINS       = "https://${local.hosts.public},https://${local.hosts.portal}"
          SESSION_COOKIE_SECURE = "true"
          REQUIRE_APP_CHECK     = "true"
          REQUIRE_MFA           = "true"
          } : {
          SURFACE       = each.key
          EXPECTED_HOST = each.value.host
          ENABLE_HSTS   = tostring(var.enable_hsts)
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = contains(["api", "portal"], each.key) ? [1] : []
        content {
          name = "IP_HASH_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.ip_hash.secret_id
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 2
        timeout_seconds       = 2
        period_seconds        = 5
        failure_threshold     = 12
      }
      liveness_probe {
        http_get { path = "/health" }
        timeout_seconds   = 2
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "load_balancer_invoker" {
  for_each = local.services
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.service[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_compute_security_policy" "edge" {
  name = "hhh-edge-policy"
  rule {
    action      = "deny(404)"
    priority    = 100
    description = "Reject hostnames outside the public site and combined portal."
    match {
      expr { expression = "!request.headers['host'].matches('^(www|portal)\\.${local.escaped_base_domain}(:[0-9]+)?$')" }
    }
  }
  rule {
    action   = "throttle"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
    }
  }
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    description = "Default allow after managed edge controls; application auth remains authoritative."
  }
}

resource "google_compute_region_network_endpoint_group" "serverless" {
  for_each              = local.services
  name                  = "hhh-${each.key}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run { service = google_cloud_run_v2_service.service[each.key].name }
}

resource "google_compute_backend_service" "service" {
  for_each              = local.services
  name                  = "hhh-${each.key}-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.edge.id
  enable_cdn            = false
  backend { group = google_compute_region_network_endpoint_group.serverless[each.key].id }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_backend_service" "public_assets" {
  name                  = "hhh-public-assets-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.edge.id
  enable_cdn            = true
  backend { group = google_compute_region_network_endpoint_group.serverless["public"].id }
  cdn_policy {
    cache_mode       = "CACHE_ALL_STATIC"
    default_ttl      = 3600
    max_ttl          = 31536000
    client_ttl       = 31536000
    negative_caching = false
    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = false
    }
  }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "https" {
  name            = "hhh-platform-map"
  default_service = google_compute_backend_service.service["public"].id

  host_rule {
    hosts        = [local.hosts.public]
    path_matcher = "public"
  }
  host_rule {
    hosts        = [local.hosts.portal]
    path_matcher = "portal"
  }

  path_matcher {
    name            = "public"
    default_service = google_compute_backend_service.service["public"].id
    path_rule {
      paths   = ["/assets/*"]
      service = google_compute_backend_service.public_assets.id
    }
    path_rule {
      paths   = ["/v1/*"]
      service = google_compute_backend_service.service["api"].id
    }
  }
  path_matcher {
    name            = "portal"
    default_service = google_compute_backend_service.service["portal"].id
    path_rule {
      paths   = ["/v1/*", "/pharmacy/v1/*", "/admin/v1/*"]
      service = google_compute_backend_service.service["api"].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "platform" {
  name = "hhh-platform-certificate"
  managed { domains = values(local.hosts) }
}

resource "google_compute_target_https_proxy" "platform" {
  name             = "hhh-platform-https"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.platform.id]
  ssl_policy       = google_compute_ssl_policy.modern.id
}

resource "google_compute_ssl_policy" "modern" {
  name            = "hhh-modern-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_global_address" "platform" { name = "hhh-platform-ip" }

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "hhh-platform-https"
  ip_address            = google_compute_global_address.platform.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.platform.id
}

resource "google_compute_url_map" "http_redirect" {
  name = "hhh-http-redirect"
  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}
resource "google_compute_target_http_proxy" "redirect" {
  name    = "hhh-http-redirect"
  url_map = google_compute_url_map.http_redirect.id
}
resource "google_compute_global_forwarding_rule" "http" {
  name                  = "hhh-platform-http"
  ip_address            = google_compute_global_address.platform.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.redirect.id
}

resource "google_firestore_field" "staff_session_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "staffSessions"
  field      = "expiresAt"
  ttl_config {}
}

resource "google_logging_metric" "auth_denials" {
  name   = "hhh_auth_denials"
  filter = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=~\"auth\\.(session_rejected|role_denied|tenant_mismatch|csrf_denied|origin_denied|app_check_denied)\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "tenant_mismatches" {
  name   = "hhh_tenant_mismatches"
  filter = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=\"auth.tenant_mismatch\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "app_check_denials" {
  name   = "hhh_app_check_denials"
  filter = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=\"auth.app_check_denied\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "auth_denial_spike" {
  display_name = "HHH authentication denial spike"
  combiner     = "OR"
  conditions {
    display_name = "More than 50 denials in five minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.auth_denials.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 50
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "tenant_mismatch_attempts" {
  display_name = "HHH repeated tenant mismatch attempts"
  combiner     = "OR"
  conditions {
    display_name = "More than five mismatches in five minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.tenant_mismatches.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "app_check_spike" {
  display_name = "HHH App Check rejection spike"
  combiner     = "OR"
  conditions {
    display_name = "More than 25 App Check rejections in five minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.app_check_denials.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 25
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}
