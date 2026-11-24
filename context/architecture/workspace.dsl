// C4 model as code (Structurizr DSL). Render: docker run -it --rm -p 8080:8080 -v $PWD:/usr/local/structurizr structurizr/lite
workspace "User Management" "C4 model of the user-management app and its context tooling" {

    model {
        admin = person "Admin" "Manages accounts, roles, invitations; reads the audit log."
        manager = person "Manager" "Searches the directory and sees it update live."
        member = person "Member" "Signs in and sees their own profile."
        invitee = person "Invitee" "Accepts an invitation link."
        team = person "Product team" "Product owner, tech lead, developers, QA."

        mail = softwareSystem "Mail service" "Delivers invitation emails (logged to the console in development)." "External"
        github = softwareSystem "GitHub" "Repository, pull requests, Actions (CI gates), Issues (task board)." "External"
        chat = softwareSystem "Slack / Teams" "Receives stale-task alerts through incoming webhooks." "External"

        ums = softwareSystem "User Management" "Accounts, roles, invitations, audit log, live directory." {
            web = container "Web app" "Sign-in, directory, invitations, audit log." "React 18, Vite" "Browser"
            api = container "API" "REST API (contracts/openapi.yaml) and Socket.IO live events." "Node.js 22, Express 4, Socket.IO 4" {
                auth = component "Auth" "Sign-in, JWT, lockout, token version." "Express router" 
                users = component "Users" "Create, read, search, role, deactivate." "Express router"
                invitations = component "Invitations" "Create and accept single-use links." "Express router"
                audit = component "Audit" "Append-only audit events." "Express router"
                realtime = component "Realtime" "Directory room for admins and managers." "Socket.IO"
            }
            db = container "Database" "users, invitations, audit_events, login_attempts" "SQLite (node:sqlite)" "Database"
        }

        ctx = softwareSystem "Context system" "Single source of truth for requirements and its distribution." {
            repo = container "context/ folder" "Requirements, ADRs, C4, contract, plan, manifest.json." "Markdown, YAML, JSON in Git"
            server = container "Context server" "Gives each agent its task slice, stamped with versions; pushes updates." "MCP (TypeScript SDK) + HTTP viewer"
            gates = container "Context gates" "Manifest, validation, stale-context, trace and impact scripts." "Node.js scripts run by GitHub Actions"
        }

        admin -> web "Uses"
        manager -> web "Uses"
        member -> web "Uses"
        invitee -> web "Accepts invitation in"
        web -> api "Calls" "HTTPS/JSON, WebSocket"
        api -> db "Reads and writes" "SQL"
        api -> mail "Sends invitations" "SMTP"
        auth -> db "Reads users, writes login attempts"
        users -> realtime "Publishes directory events"
        users -> audit "Records events"
        invitations -> audit "Records events"

        team -> github "Opens change requests and pull requests"
        github -> gates "Runs on every pull request"
        gates -> repo "Reads"
        gates -> chat "Sends stale alerts"
        server -> repo "Reads and watches"
        team -> server "Reads context (through their agents)" "MCP"
    }

    views {
        systemContext ums "SystemContext" { include * autolayout lr }
        container ums "Containers" { include * autolayout lr }
        component api "ApiComponents" { include * autolayout lr }
        container ctx "ContextSystem" { include * autolayout lr }
        styles {
            element "Person" { shape Person background #08427b color #ffffff }
            element "External" { background #999999 color #ffffff }
            element "Database" { shape Cylinder }
            element "Browser" { shape WebBrowser }
        }
    }
}
