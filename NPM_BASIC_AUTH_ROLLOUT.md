# Jira MCP behind Nginx Proxy Manager Basic Auth

This runbook describes how to roll out the local Jira MCP server when the public
Jira domain is protected by an Nginx Proxy Manager (NPM) Basic Auth Access List.

## Why both sides must change

NPM Basic Auth and Jira PAT authentication both normally use the HTTP
`Authorization` header. The local MCP server therefore sends:

- `Authorization: Basic ...` for the NPM Access List;
- `X-Jira-Authorization: Bearer ...` for Jira.

NPM must authenticate the first header and copy the second value into the
upstream `Authorization` header before forwarding the request to Jira.

## Required values

Prepare these values without committing them to Git:

- public Jira URL, for example `https://jira.example.com`;
- Jira PAT;
- an existing NPM Access List username and password;
- the NPM Proxy Host and Access List that protect the Jira domain.

Prefer a dedicated Access List user for the MCP server. Do not create or rotate
credentials during this rollout unless that is explicitly authorized.

## Recommended rollout order

1. Build and test the local MCP server.
2. Back up or export the current NPM Proxy Host and Access List configuration.
3. Add the NPM forwarding rule and validate Nginx configuration.
4. Test the public Jira REST endpoint through NPM with `curl`.
5. Add the NPM credentials to the existing `jira-local` MCP configuration.
6. Restart Codex and run an MCP smoke test.

This order keeps a working checkpoint between the proxy change and the MCP
client change.

## 1. Build the local MCP server

The current Codex MCP entry already points to:

```text
/Users/kolzhikov/development/mcp-jira-server/build/index.js
```

Build and run the test suite:

```bash
cd /Users/kolzhikov/development/mcp-jira-server
npm test
```

`npm test` runs `npm run build` first, so a separate build command is not
required. On a fresh checkout, run `npm ci` before `npm test`.

Expected result:

```text
# tests 6
# pass 6
# fail 0
```

Do not use `npx -y mcp-jira-server` for this rollout: until a new package version
is published, that command downloads the released package without these local
changes.

## 2. Configure Nginx Proxy Manager

The NPM change must be applied to the custom location `/`, not only to the
Proxy Host's server-level Advanced field.

For the Jira Proxy Host:

1. Record the current forward scheme, host, port, SSL settings, Access List, and
   all existing custom locations.
2. In the Jira Access List, enable **Pass Auth to Host**.
3. Create or update the custom location `/` with the same upstream scheme, host,
   and port as the existing Jira Proxy Host.
4. Assign the same Basic Auth Access List to that custom location.
5. Add the following to the custom location's Advanced configuration:

```nginx
proxy_set_header Authorization $http_x_jira_authorization;
proxy_set_header X-Jira-Authorization "";
```

6. Save through the NPM UI or API.
7. Validate the generated Nginx configuration with `nginx -t` inside the NPM
   container before or as part of the reload.

Do not hard-code the Jira PAT or the NPM password in Nginx configuration. Do not
edit NPM-generated files as the source of truth because NPM can overwrite them.

If the NPM API is used, first read the complete current object and merge the
change. Do not send a partial replacement that can erase existing locations,
Access List entries, SSL settings, or other Proxy Host fields.

## 3. Test the NPM bridge before changing Codex

Read secrets interactively so they are not placed directly in shell history:

```bash
printf 'NPM username: '
IFS= read -r JIRA_PROXY_BASIC_AUTH_USERNAME
printf 'NPM password: '
IFS= read -rs JIRA_PROXY_BASIC_AUTH_PASSWORD
printf '\nJira PAT: '
IFS= read -rs JIRA_PAT
printf '\n'
export JIRA_PROXY_BASIC_AUTH_USERNAME JIRA_PROXY_BASIC_AUTH_PASSWORD JIRA_PAT
```

Set the public URL and test Jira's current-user endpoint:

```bash
JIRA_BASE_URL='https://jira.example.com'

curl --fail-with-body --silent --show-error \
  --user "${JIRA_PROXY_BASIC_AUTH_USERNAME}:${JIRA_PROXY_BASIC_AUTH_PASSWORD}" \
  --header "X-Jira-Authorization: Bearer ${JIRA_PAT}" \
  "${JIRA_BASE_URL}/rest/api/2/myself"
```

Expected result: HTTP 200 and Jira user JSON.

Also verify:

- no Basic Auth header returns NPM `401`;
- incorrect Basic credentials return NPM `401`;
- the normal Jira browser UI still opens after NPM authentication;
- the Proxy Host still uses the original upstream, certificate, and SSL policy.

Clear the temporary shell values after the test:

```bash
unset JIRA_PROXY_BASIC_AUTH_USERNAME JIRA_PROXY_BASIC_AUTH_PASSWORD JIRA_PAT
```

## 4. Update the existing Codex MCP configuration

Codex already has an enabled stdio MCP server named `jira-local` with:

```text
command: /usr/local/bin/node
args: /Users/kolzhikov/development/mcp-jira-server/build/index.js
```

Edit the existing `jira-local` entry in `~/.codex/config.toml`. Preserve the
existing `JIRA_BASE_URL`, `JIRA_PAT`, `JIRA_USER_AGENT`, and
`JIRA_ALLOW_ISSUE_DELETE` values, then add:

```toml
[mcp_servers.jira-local.env]
JIRA_PROXY_BASIC_AUTH_USERNAME = "<NPM_ACCESS_LIST_USERNAME>"
JIRA_PROXY_BASIC_AUTH_PASSWORD = "<NPM_ACCESS_LIST_PASSWORD>"
JIRA_PROXY_JIRA_AUTH_HEADER = "X-Jira-Authorization"
```

If `[mcp_servers.jira-local.env]` already exists, add the three keys to that
existing table; do not create a duplicate TOML table.

The third variable is optional because `X-Jira-Authorization` is the default,
but keeping it explicit makes the NPM/MCP contract visible.

The MCP server is stdio-based. Codex starts it automatically; it is not a daemon
that should be left running manually.

After saving the configuration, fully restart Codex so the existing MCP process
is replaced with the freshly built server and new environment.

## 5. MCP smoke test

In a new Codex task, ask the agent to:

1. call `jira_get_current_user`;
2. fetch one known issue with `jira_get_issue`;
3. optionally search a small read-only JQL query.

Do not begin with create, update, comment, transition, or delete operations.

Success criteria:

- `jira_get_current_user` returns the PAT owner;
- `jira_get_issue` returns Jira data rather than an NPM HTML login page;
- NPM access logs show an authenticated request;
- Jira receives Bearer authentication and does not see the NPM Basic
  credentials.

## Rollback

If the NPM bridge fails:

1. restore the exported Proxy Host and Access List configuration;
2. remove the custom-location header rewrite;
3. restore the previous **Pass Auth to Host** value;
4. validate with `nginx -t` and reload Nginx;
5. remove only the three `JIRA_PROXY_*` keys from the `jira-local` MCP
   configuration;
6. restart Codex.

The original PAT-only behavior remains available when the
`JIRA_PROXY_BASIC_AUTH_USERNAME` and `JIRA_PROXY_BASIC_AUTH_PASSWORD` variables
are absent.

## Handoff prompt for the NPM agent

Copy the text below into the infrastructure agent's task and replace the angle
bracket placeholders. Do not put passwords or Jira PAT values in the prompt.

```text
Нужно безопасно изменить существующий Nginx Proxy Manager Proxy Host для Jira.

Цель:
- публичный домен Jira: <JIRA_PUBLIC_DOMAIN>;
- существующий Proxy Host: <PROXY_HOST_NAME_OR_ID>;
- существующий Basic Auth Access List: <ACCESS_LIST_NAME_OR_ID>;
- сохранить текущий upstream, SSL-сертификат, HSTS/HTTP2/WebSocket-настройки,
  access rules и все остальные custom locations.

Причина изменения:
Входящий запрос MCP использует Authorization: Basic ... для NPM и
X-Jira-Authorization: Bearer ... для Jira. После успешной Basic Auth проверки
NPM должен передать в Jira Bearer-значение как обычный Authorization.

Требуемое изменение:
1. Сначала прочитать и зафиксировать полную текущую конфигурацию Proxy Host и
   Access List, достаточную для точного rollback.
2. Включить Pass Auth to Host для указанного Access List.
3. Создать или обновить custom location "/" с тем же forward scheme/host/port,
   который уже используется для Jira, и назначить ему тот же Access List.
4. Именно в Advanced-настройку custom location "/" добавить:

   proxy_set_header Authorization $http_x_jira_authorization;
   proxy_set_header X-Jira-Authorization "";

5. Не помещать Jira PAT, Basic Auth пароль или другие секреты в NPM config,
   команды, логи, Git или отчёт.
6. Не редактировать сгенерированные NPM nginx-файлы как постоянный источник
   конфигурации.
7. Если используется NPM API, выполнить read-modify-write полного объекта. Не
   отправлять слепой partial PUT, который может удалить существующие поля или
   locations.
8. Проверить отсутствие конфликтующего/дублирующего location "/".
9. Выполнить nginx -t внутри NPM-контейнера, затем безопасно применить/reload.

Критерии приёмки:
- запрос без Basic Auth по-прежнему получает 401 от NPM;
- неверные Basic credentials получают 401;
- валидный Basic Auth + заголовок
  X-Jira-Authorization: Bearer <token> достигает Jira REST API;
- Jira UI продолжает открываться через браузер;
- upstream, TLS и остальные настройки домена не изменились;
- в итоговом отчёте указаны изменённые Proxy Host/Access List и результат
  nginx -t, но нет секретов.

Если точный Proxy Host, Access List, upstream или способ безопасного rollback не
удаётся однозначно определить, остановиться до изменения состояния и запросить
уточнение.
```
