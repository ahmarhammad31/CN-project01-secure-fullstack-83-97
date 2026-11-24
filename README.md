# DCCN Project 01: Secure Full-Stack Web Application

- **Partner A:** BSCS25083
- **Partner B:** BSCS25097
- **Instructor:** Mr. Zeeshan Ali

## Network Addressing Plan (`192.168.83.0/24`)
| Hostname | IP Address | Role |
| :--- | :--- | :--- |
| Host (Client) | `192.168.83.1` | Admin / Testing Client |
| `bscs25083-web` | `192.168.83.10` | VM1: Nginx Reverse Proxy + Built Frontend |
| `bscs25083-api` | `192.168.83.20` | VM2: Backend REST API + Database (`127.0.0.1`) |
| `bscs25083-docker` | `192.168.83.30` | Part 5: Docker Compose Deployment |

## Repository Structure
- `frontend/` — React (Vite) application
- `backend/` — FastAPI REST API
- `nginx/` — Nginx reverse proxy & TLS configurations
- `docker/` — `docker-compose.yml` & container configs
- `ufw/` — Firewall rule exports from both VMs
- `docs/` — Evidence screenshots & report drafts
