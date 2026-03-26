# mcp-jira-server

MCP server for self-hosted Jira instances using Personal Access Token (PAT) authentication.

This project exposes Jira operations as MCP tools so assistants such as Claude Desktop, VS Code, or any MCP-compatible client can search issues, update tickets, manage links, and download attachments from a Jira Server / Data Center deployment.

## What This Repository Does

- Connects to a self-hosted Jira instance over the Jira REST API v2
- Authenticates with a Jira Personal Access Token
- Exposes Jira capabilities as MCP tools over `stdio`
- Supports issue search, create, update, comments, assignments, projects, issue types, links, current user lookup, and attachments
- Keeps issue deletion disabled by default behind an explicit safety flag

## Scope

- Supported: self-hosted Jira / Jira Server / Jira Data Center style deployments using PAT auth
- Not targeted: Jira Cloud
- Transport: `stdio`
- Runtime: Node.js 18+

## Tool Summary

| Tool | Purpose |
| --- | --- |
| `jira_get_issue` | Fetch a single issue by key |
| `jira_search_issues` | Run JQL search queries |
| `jira_create_issue` | Create a new issue |
| `jira_update_issue` | Update fields and optionally transition status |
| `jira_add_comment` | Add a comment to an issue |
| `jira_get_comments` | List comments for an issue |
| `jira_get_projects` | List Jira projects |
| `jira_get_project` | Fetch one project |
| `jira_get_issue_types` | List issue types for a project |
| `jira_get_issue_link_types` | List available issue link types |
| `jira_create_issue_link` | Create a link between issues |
| `jira_delete_issue_link` | Delete a link by ID or relationship |
| `jira_assign_issue` | Assign an issue |
| `jira_delete_issue` | Permanently delete an issue, if explicitly enabled |
| `jira_get_current_user` | Return the authenticated Jira user |
| `jira_get_attachment` | Fetch attachment metadata |
| `jira_download_attachment` | Download attachment content through authenticated MCP access |

## Requirements

- Node.js 18 or newer
- A reachable self-hosted Jira base URL such as `https://jira.example.com`
- A Jira Personal Access Token with the permissions required for the operations you want to perform

## Install

### Option 1: Run from npm

```bash
npx -y mcp-jira-server
```

or install globally:

```bash
npm install -g mcp-jira-server
```

### Option 2: Run from source

```bash
git clone https://github.com/edrich13/mcp-jira-server.git
cd mcp-jira-server
npm install
npm run build
```

## Configuration

The server reads configuration from environment variables.

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_BASE_URL` | Yes | Base URL of your Jira instance, for example `https://jira.example.com` |
| `JIRA_PAT` | Yes | Jira Personal Access Token |
| `JIRA_USER_AGENT` | No | Custom `User-Agent` for environments behind SSO proxies or reverse proxies |
| `JIRA_ALLOW_ISSUE_DELETE` | No | Set to `true` to expose the destructive `jira_delete_issue` tool |

Example `.env` values:

```env
JIRA_BASE_URL=https://jira.example.com
JIRA_PAT=your_personal_access_token
# JIRA_USER_AGENT=YourAllowedUserAgent/1.0
# JIRA_ALLOW_ISSUE_DELETE=false
```

The repository also includes:

- `claude_desktop_config.example.json`
- `vscode_mcp_config.example.json`
- `.env.example`

## Quick Start

### Claude Desktop

Using the published package:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "mcp-jira-server"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_PAT": "your-personal-access-token"
      }
    }
  }
}
```

Using a local build from this repository:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-jira-server/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_PAT": "your-personal-access-token"
      }
    }
  }
}
```

### VS Code MCP

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-jira-server/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_PAT": "your-personal-access-token"
      }
    }
  }
}
```

After updating the config or rebuilding the project, restart the MCP host application so it launches the fresh server process.

## Usage Examples

Example assistant requests:

- `Get issue PROJ-123`
- `Search for all open bugs assigned to me`
- `Create a high-priority bug in MOBILE with summary "Login spinner never stops"`
- `Move PROJ-123 to In Progress and assign it to john.doe`
- `Show me the available issue link types`
- `Create an issue link where PROJ-101 blocks PROJ-202`
- `Get attachment metadata for 10873`
- `Download attachment 10873`

## Tool Details

### Issue tools

#### `jira_get_issue`

Fetch a single issue by key.

Parameters:

- `issueKey` (required)

#### `jira_search_issues`

Run a JQL query.

Parameters:

- `jql` (required)
- `maxResults` (optional, default `50`)

Examples:

- `project = PROJ AND status = Open`
- `assignee = currentUser() AND status != Done`
- `priority = High AND created >= -7d`

#### `jira_create_issue`

Create a new issue.

Parameters:

- `projectKey` (required)
- `summary` (required)
- `issueType` (required)
- `description` (optional)
- `priority` (optional)
- `assignee` (optional)
- `labels` (optional)
- `components` (optional)
- `customFields` (optional)

`customFields` accepts only keys matching `customfield_<digits>`.

#### `jira_update_issue`

Update an existing issue.

Parameters:

- `issueKey` (required)
- `summary` (optional)
- `description` (optional)
- `assignee` (optional)
- `priority` (optional)
- `labels` (optional)
- `status` (optional)
- `customFields` (optional)

If `status` is provided, the server resolves the matching Jira transition and applies it after the field update.

#### `jira_assign_issue`

Assign an issue to a user.

Parameters:

- `issueKey` (required)
- `assignee` (required)

#### `jira_delete_issue`

Delete an issue permanently.

Parameters:

- `issueKey` (required)
- `confirmation` (required, must equal `DELETE`)

This tool is only exposed when `JIRA_ALLOW_ISSUE_DELETE=true`.

### Comment tools

#### `jira_add_comment`

Add a comment to an issue.

Parameters:

- `issueKey` (required)
- `comment` (required)

#### `jira_get_comments`

List comments for an issue.

Parameters:

- `issueKey` (required)

### Project and metadata tools

#### `jira_get_projects`

List all available Jira projects.

#### `jira_get_project`

Fetch one project by key.

Parameters:

- `projectKey` (required)

#### `jira_get_issue_types`

List issue types available for a project.

Parameters:

- `projectKey` (required)

#### `jira_get_current_user`

Return the currently authenticated Jira user.

### Issue link tools

#### `jira_get_issue_link_types`

List the issue link types configured in Jira, including `name`, `outward`, and `inward` text.

#### `jira_create_issue_link`

Create a link between two issues.

Parameters:

- `fromIssueKey` (required)
- `toIssueKey` (required)
- `relationship` (required)
- `comment` (optional)

The relationship can be either the Jira link type name, or the outward/inward relationship text such as `blocks` or `is blocked by`.

#### `jira_delete_issue_link`

Delete a link either by link ID or by resolving a relationship between two issue keys.

Parameters:

- `linkId` (optional)
- `fromIssueKey` (optional)
- `toIssueKey` (optional)
- `relationship` (optional)

Provide either:

- `linkId`
- or `fromIssueKey` + `toIssueKey` + `relationship`

### Attachment tools

#### `jira_get_attachment`

Fetch attachment metadata by Jira attachment ID.

Parameters:

- `attachmentId` (required)

#### `jira_download_attachment`

Download attachment content through authenticated MCP access.

Parameters:

- `attachmentId` (required)
- `format` (optional: `auto`, `text`, `base64`)
- `maxBytes` (optional, default `262144`)

Behavior:

- `auto` returns UTF-8 for text-like files and Base64 for binary files
- Large files are blocked unless `maxBytes` is increased
- The server performs the authenticated Jira download for you; do not rely on raw attachment URLs in the assistant

## Authentication Notes

### Personal Access Tokens

How PATs are created depends on the Jira deployment and version, but in most self-hosted Jira setups you can create them from your profile or security settings.

Use a token with the minimum permissions required for the tasks you want the assistant to perform.

### Reverse proxies and SSO

If your Jira API requests are redirected to SSO or `login.jsp` even though the PAT is valid, your deployment may be behind a proxy such as:

- `oauth2-proxy`
- `nginx`
- another gateway that filters by `User-Agent`

In that case, set `JIRA_USER_AGENT` to a whitelisted value accepted by your environment.

## Troubleshooting

### The MCP host does not see my changes

- Run `npm run build`
- Make sure your MCP config points to `build/index.js`
- Restart the MCP host application after rebuilding

### Jira API requests return unauthorized or login redirects

- Verify `JIRA_BASE_URL`
- Verify the PAT is still valid
- Verify the PAT has permission for the target project or issue
- Try setting `JIRA_USER_AGENT`

### Raw Jira attachment URLs fail

This is expected in many MCP setups.

Raw URLs such as:

- `/secure/attachment/...`
- `/rest/api/2/attachment/<id>`

may fail when opened directly by the host because the assistant session does not share your browser login state. Use `jira_get_attachment` or `jira_download_attachment` instead.

### `jira_delete_issue` is missing

Set:

```env
JIRA_ALLOW_ISSUE_DELETE=true
```

and restart the host application.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Watch mode:

```bash
npm run watch
```

Run directly in development:

```bash
npm run dev
```

## Security

- Never commit a real PAT
- Keep `.env` files out of version control
- Prefer tokens with the narrowest possible scope
- Leave `JIRA_ALLOW_ISSUE_DELETE` disabled unless you explicitly need destructive actions

## License

MIT
