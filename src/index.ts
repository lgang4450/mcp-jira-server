#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  JiraClient,
  CreateIssueInput,
  UpdateIssueInput,
  CreateIssueLinkInput,
  DeleteIssueLinkInput,
} from './jira-client.js';

// Environment variables
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USER_AGENT = process.env.JIRA_USER_AGENT;
const JIRA_ALLOW_ISSUE_DELETE = process.env.JIRA_ALLOW_ISSUE_DELETE === 'true';
const DELETE_ISSUE_CONFIRMATION_VALUE = 'DELETE';
const DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES = 256 * 1024;

type AttachmentContentFormat = 'auto' | 'text' | 'base64';

function normalizeAttachmentFormat(value: unknown): AttachmentContentFormat {
  if (value === undefined || value === 'auto' || value === 'text' || value === 'base64') {
    return (value ?? 'auto') as AttachmentContentFormat;
  }

  throw new Error('format must be one of: auto, text, base64');
}

function normalizeAttachmentMaxBytes(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('maxBytes must be a positive number.');
  }

  return Math.floor(value);
}

function isTextLikeAttachment(mimeType?: string): boolean {
  if (!mimeType) {
    return false;
  }

  const normalizedMimeType = mimeType.toLowerCase();
  return normalizedMimeType.startsWith('text/')
    || normalizedMimeType === 'application/json'
    || normalizedMimeType === 'application/xml'
    || normalizedMimeType === 'application/javascript'
    || normalizedMimeType === 'application/x-javascript'
    || normalizedMimeType.endsWith('+json')
    || normalizedMimeType.endsWith('+xml');
}

function getAttachmentAccessHint(attachmentId: string): string {
  return `Direct Jira attachment URLs require Jira authentication headers or a browser session. Use jira_download_attachment with attachmentId="${attachmentId}" to fetch the file through the authenticated MCP server.`;
}

// Function to check if environment variables are configured
function checkEnvironmentConfig(): { isConfigured: boolean; error?: string } {
  const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
  const JIRA_PAT = process.env.JIRA_PAT;
  
  if (!JIRA_BASE_URL || !JIRA_PAT) {
    return {
      isConfigured: false,
      error: 'JIRA_BASE_URL and JIRA_PAT environment variables are required. Please configure them before using Jira functionality.'
    };
  }
  return { isConfigured: true };
}

// Initialize Jira client (will be created on demand)
let jiraClient: JiraClient | null = null;

function getJiraClient(): JiraClient {
  const config = checkEnvironmentConfig();
  if (!config.isConfigured) {
    throw new Error(config.error);
  }
  
  if (!jiraClient) {
    const JIRA_BASE_URL = process.env.JIRA_BASE_URL!;
    const JIRA_PAT = process.env.JIRA_PAT!;
    const JIRA_USER_AGENT = process.env.JIRA_USER_AGENT;
    
    jiraClient = new JiraClient({
      baseUrl: JIRA_BASE_URL,
      personalAccessToken: JIRA_PAT,
      userAgent: JIRA_USER_AGENT,
    });
  }
  
  return jiraClient;
}

// Define tools
const tools: Tool[] = [
  {
    name: 'jira_get_issue',
    description: 'Get details of a specific Jira issue by its key (e.g., PROJ-123)',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key (e.g., PROJ-123)',
        },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_search_issues',
    description: 'Search for Jira issues using JQL (Jira Query Language). Examples: "project = PROJ AND status = Open", "assignee = currentUser() AND status != Done"',
    inputSchema: {
      type: 'object',
      properties: {
        jql: {
          type: 'string',
          description: 'JQL query string to search for issues',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
          default: 50,
        },
      },
      required: ['jql'],
    },
  },
  {
    name: 'jira_create_issue',
    description: 'Create a new Jira issue in a specified project',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: {
          type: 'string',
          description: 'The project key where the issue will be created',
        },
        summary: {
          type: 'string',
          description: 'Brief summary/title of the issue',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the issue',
        },
        issueType: {
          type: 'string',
          description: 'Type of issue (e.g., Bug, Task, Story, Epic)',
        },
        priority: {
          type: 'string',
          description: 'Priority level (e.g., High, Medium, Low)',
        },
        assignee: {
          type: 'string',
          description: 'Username of the person to assign the issue to',
        },
        labels: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Array of labels to add to the issue',
        },
        components: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Array of component names',
        },
        customFields: {
          type: 'object',
          description: 'Map of Jira custom fields only (keys must match customfield_<digits>, e.g., customfield_10211)',
          propertyNames: {
            pattern: '^customfield_[0-9]+$',
          },
          additionalProperties: true,
        },
      },
      required: ['projectKey', 'summary', 'issueType'],
    },
  },
  {
    name: 'jira_update_issue',
    description: 'Update an existing Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key to update',
        },
        summary: {
          type: 'string',
          description: 'New summary/title for the issue',
        },
        description: {
          type: 'string',
          description: 'New description for the issue',
        },
        assignee: {
          type: 'string',
          description: 'Username to assign the issue to',
        },
        priority: {
          type: 'string',
          description: 'New priority level',
        },
        labels: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'New array of labels',
        },
        status: {
          type: 'string',
          description: 'New status/workflow state (e.g., "In Progress", "Done")',
        },
        customFields: {
          type: 'object',
          description: 'Map of Jira custom fields only (keys must match customfield_<digits>, e.g., customfield_10211)',
          propertyNames: {
            pattern: '^customfield_[0-9]+$',
          },
          additionalProperties: true,
        },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_add_comment',
    description: 'Add a comment to a Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key',
        },
        comment: {
          type: 'string',
          description: 'The comment text to add',
        },
      },
      required: ['issueKey', 'comment'],
    },
  },
  {
    name: 'jira_get_comments',
    description: 'Get all comments from a Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key',
        },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_get_projects',
    description: 'List all available Jira projects',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'jira_get_project',
    description: 'Get details of a specific Jira project',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: {
          type: 'string',
          description: 'The project key',
        },
      },
      required: ['projectKey'],
    },
  },
  {
    name: 'jira_get_issue_types',
    description: 'Get available issue types for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: {
          type: 'string',
          description: 'The project key',
        },
      },
      required: ['projectKey'],
    },
  },
  {
    name: 'jira_get_issue_link_types',
    description: 'Get available Jira issue link types with their outward and inward relationship text (e.g., Blocks, Duplicate, Relates)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'jira_create_issue_link',
    description: 'Create a Jira issue link between two issues. The relationship can be a link type name (e.g., "Blocks", "Duplicate", "Relates") or directional text (e.g., "blocks", "is blocked by", "duplicates").',
    inputSchema: {
      type: 'object',
      properties: {
        fromIssueKey: {
          type: 'string',
          description: 'Source issue key for the relationship you want to express',
        },
        toIssueKey: {
          type: 'string',
          description: 'Target issue key for the relationship you want to express',
        },
        relationship: {
          type: 'string',
          description: 'Link relationship or type name, such as "blocks", "is blocked by", "duplicates", or "Relates"',
        },
        comment: {
          type: 'string',
          description: 'Optional comment to add while creating the link',
        },
      },
      required: ['fromIssueKey', 'toIssueKey', 'relationship'],
    },
  },
  {
    name: 'jira_delete_issue_link',
    description: 'Delete a Jira issue link either by linkId or by resolving it from two issue keys and a relationship',
    inputSchema: {
      type: 'object',
      properties: {
        linkId: {
          type: 'string',
          description: 'Issue link ID to delete directly',
        },
        fromIssueKey: {
          type: 'string',
          description: 'Source issue key when deleting by relationship instead of linkId',
        },
        toIssueKey: {
          type: 'string',
          description: 'Target issue key when deleting by relationship instead of linkId',
        },
        relationship: {
          type: 'string',
          description: 'Relationship or link type used to resolve the link, such as "blocks" or "Relates"',
        },
      },
      oneOf: [
        {
          required: ['linkId'],
        },
        {
          required: ['fromIssueKey', 'toIssueKey', 'relationship'],
        },
      ],
    },
  },
  {
    name: 'jira_assign_issue',
    description: 'Assign a Jira issue to a user',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key',
        },
        assignee: {
          type: 'string',
          description: 'Username to assign the issue to',
        },
      },
      required: ['issueKey', 'assignee'],
    },
  },
  {
    name: 'jira_delete_issue',
    description: 'Delete a Jira issue permanently',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The Jira issue key to delete',
        },
        confirmation: {
          type: 'string',
          description: 'Must be exactly "DELETE" to confirm permanent deletion',
        },
      },
      required: ['issueKey', 'confirmation'],
    },
  },
  {
    name: 'jira_get_current_user',
    description: 'Get information about the currently authenticated user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'jira_get_attachment',
    description: 'Get Jira attachment metadata by attachment id. Use this when raw Jira attachment URLs fail without authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        attachmentId: {
          type: 'string',
          description: 'The Jira attachment id',
        },
      },
      required: ['attachmentId'],
    },
  },
  {
    name: 'jira_download_attachment',
    description: 'Download a Jira attachment through the authenticated MCP server and return it as text or base64.',
    inputSchema: {
      type: 'object',
      properties: {
        attachmentId: {
          type: 'string',
          description: 'The Jira attachment id',
        },
        format: {
          type: 'string',
          enum: ['auto', 'text', 'base64'],
          description: 'How to encode the returned content. "auto" returns UTF-8 text for text-like files and base64 otherwise.',
          default: 'auto',
        },
        maxBytes: {
          type: 'number',
          description: `Maximum attachment size to return in bytes (default: ${DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES})`,
          default: DEFAULT_ATTACHMENT_DOWNLOAD_MAX_BYTES,
        },
      },
      required: ['attachmentId'],
    },
  },
];

const availableTools = JIRA_ALLOW_ISSUE_DELETE
  ? tools
  : tools.filter(tool => tool.name !== 'jira_delete_issue');

// Create server instance
const server = new Server(
  {
    name: 'mcp-jira-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: availableTools,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args = {} } = request.params;

    switch (name) {
      case 'jira_get_issue': {
        const issue = await getJiraClient().getIssue(args.issueKey as string);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      }

      case 'jira_search_issues': {
        const issues = await getJiraClient().searchIssues(
          args.jql as string,
          args.maxResults as number
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issues, null, 2),
            },
          ],
        };
      }

      case 'jira_create_issue': {
        const input: CreateIssueInput = {
          projectKey: args.projectKey as string,
          summary: args.summary as string,
          description: args.description as string,
          issueType: args.issueType as string,
          priority: args.priority as string,
          assignee: args.assignee as string,
          labels: args.labels as string[],
          components: args.components as string[],
          customFields: args.customFields as Record<string, unknown>,
        };
        const issue = await getJiraClient().createIssue(input);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully created issue ${issue.key}\n\n${JSON.stringify(issue, null, 2)}`,
            },
          ],
        };
      }

      case 'jira_update_issue': {
        const input: UpdateIssueInput = {
          summary: args.summary as string,
          description: args.description as string,
          assignee: args.assignee as string,
          priority: args.priority as string,
          labels: args.labels as string[],
          customFields: args.customFields as Record<string, unknown>,
          status: args.status as string,
        };
        const issue = await getJiraClient().updateIssue(args.issueKey as string, input);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully updated issue ${issue.key}\n\n${JSON.stringify(issue, null, 2)}`,
            },
          ],
        };
      }

      case 'jira_add_comment': {
        const comment = await getJiraClient().addComment(
          args.issueKey as string,
          args.comment as string
        );
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added comment to ${args.issueKey}\n\n${JSON.stringify(comment, null, 2)}`,
            },
          ],
        };
      }

      case 'jira_get_comments': {
        const comments = await getJiraClient().getComments(args.issueKey as string);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(comments, null, 2),
            },
          ],
        };
      }

      case 'jira_get_projects': {
        const projects = await getJiraClient().getProjects();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projects, null, 2),
            },
          ],
        };
      }

      case 'jira_get_project': {
        const project = await getJiraClient().getProject(args.projectKey as string);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(project, null, 2),
            },
          ],
        };
      }

      case 'jira_get_issue_types': {
        const issueTypes = await getJiraClient().getIssueTypes(args.projectKey as string);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issueTypes, null, 2),
            },
          ],
        };
      }

      case 'jira_get_issue_link_types': {
        const issueLinkTypes = await getJiraClient().getIssueLinkTypes();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issueLinkTypes, null, 2),
            },
          ],
        };
      }

      case 'jira_create_issue_link': {
        const input: CreateIssueLinkInput = {
          fromIssueKey: args.fromIssueKey as string,
          toIssueKey: args.toIssueKey as string,
          relationship: args.relationship as string,
          comment: args.comment as string,
        };
        const issueLink = await getJiraClient().createIssueLink(input);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully created an issue link between ${args.fromIssueKey} and ${args.toIssueKey}\n\n${JSON.stringify(issueLink, null, 2)}`,
            },
          ],
        };
      }

      case 'jira_delete_issue_link': {
        const input: DeleteIssueLinkInput = {
          linkId: args.linkId as string,
          fromIssueKey: args.fromIssueKey as string,
          toIssueKey: args.toIssueKey as string,
          relationship: args.relationship as string,
        };
        const result = await getJiraClient().deleteIssueLink(input);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted issue link${args.linkId ? ` ${args.linkId}` : ''}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'jira_assign_issue': {
        await getJiraClient().assignIssue(args.issueKey as string, args.assignee as string);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully assigned ${args.issueKey} to ${args.assignee}`,
            },
          ],
        };
      }

      case 'jira_delete_issue': {
        if (!JIRA_ALLOW_ISSUE_DELETE) {
          throw new Error('Issue deletion is disabled. Set JIRA_ALLOW_ISSUE_DELETE=true to enable jira_delete_issue.');
        }

        if (args.confirmation !== DELETE_ISSUE_CONFIRMATION_VALUE) {
          throw new Error(`Deletion requires explicit confirmation: confirmation="${DELETE_ISSUE_CONFIRMATION_VALUE}"`);
        }

        await getJiraClient().deleteIssue(args.issueKey as string);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted issue ${args.issueKey}`,
            },
          ],
        };
      }

      case 'jira_get_current_user': {
        const user = await getJiraClient().getCurrentUser();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(user, null, 2),
            },
          ],
        };
      }

      case 'jira_get_attachment': {
        const attachmentId = args.attachmentId as string;
        const attachment = await getJiraClient().getAttachment(attachmentId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...attachment,
                contentUrlRequiresAuthentication: true,
                accessHint: getAttachmentAccessHint(attachmentId),
              }, null, 2),
            },
          ],
        };
      }

      case 'jira_download_attachment': {
        const attachmentId = args.attachmentId as string;
        const format = normalizeAttachmentFormat(args.format);
        const maxBytes = normalizeAttachmentMaxBytes(args.maxBytes);
        const download = await getJiraClient().downloadAttachment(attachmentId);

        if (download.content.length > maxBytes) {
          throw new Error(
            `Attachment ${attachmentId} is ${download.content.length} bytes, which exceeds maxBytes=${maxBytes}. Increase maxBytes to download it, or use jira_get_attachment to inspect metadata only.`
          );
        }

        const encoding = format === 'base64'
          ? 'base64'
          : format === 'text'
            ? 'utf8'
            : isTextLikeAttachment(download.metadata.mimeType)
              ? 'utf8'
              : 'base64';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                metadata: download.metadata,
                contentEncoding: encoding,
                content: download.content.toString(encoding),
                contentUrlRequiresAuthentication: true,
                accessHint: getAttachmentAccessHint(attachmentId),
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}\n\n${error.response?.data ? JSON.stringify(error.response.data, null, 2) : ''}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  const config = checkEnvironmentConfig();
  if (config.isConfigured) {
    console.error('Jira MCP Server running on stdio (configured)');
  } else {
    console.error('Jira MCP Server running on stdio (not configured - JIRA_BASE_URL and JIRA_PAT required)');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
