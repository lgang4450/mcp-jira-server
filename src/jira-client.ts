import axios, { AxiosInstance } from 'axios';

const ISSUE_LINK_TYPE_SEPARATOR = ', ';

function normalizeIssueLinkRelationship(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeIssueKey(value: string): string {
  return value.trim().toUpperCase();
}

function formatAvailableIssueLinkTypes(issueLinkTypes: JiraIssueLinkType[]): string {
  return issueLinkTypes
    .map(type => `"${type.name}" (outward: "${type.outward}", inward: "${type.inward}")`)
    .join(ISSUE_LINK_TYPE_SEPARATOR);
}

function getIssueLinkTargetKey(issue?: { key?: string }): string | undefined {
  return typeof issue?.key === 'string' ? issue.key : undefined;
}

function issueLinkMatchesType(issueLink: JiraIssueLink, issueLinkType: JiraIssueLinkType): boolean {
  if (issueLink.type?.id && issueLinkType.id) {
    return issueLink.type.id === issueLinkType.id;
  }

  return normalizeIssueLinkRelationship(issueLink.type?.name || '') === normalizeIssueLinkRelationship(issueLinkType.name);
}

function summarizeIssueLink(issueLink: JiraIssueLink): Record<string, unknown> {
  return {
    id: issueLink.id,
    type: issueLink.type,
    inwardIssueKey: issueLink.inwardIssue?.key,
    outwardIssueKey: issueLink.outwardIssue?.key,
  };
}

export interface JiraConfig {
  baseUrl: string;
  personalAccessToken: string;
  userAgent?: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    priority?: {
      name: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    };
    reporter?: {
      displayName: string;
      emailAddress: string;
    };
    created: string;
    updated: string;
    [key: string]: any;
  };
}

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraIssueLink {
  id: string;
  type: JiraIssueLinkType;
  inwardIssue?: {
    key: string;
    fields?: Record<string, unknown>;
  };
  outwardIssue?: {
    key: string;
    fields?: Record<string, unknown>;
  };
}

export interface CreateIssueLinkInput {
  fromIssueKey: string;
  toIssueKey: string;
  relationship: string;
  comment?: string;
}

export interface DeleteIssueLinkInput {
  linkId?: string;
  fromIssueKey?: string;
  toIssueKey?: string;
  relationship?: string;
}

interface ResolvedIssueLinkType {
  issueLinkType: JiraIssueLinkType;
  direction: 'outward' | 'inward';
  matchedBy: 'name' | 'outward' | 'inward';
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrls?: {
    '48x48'?: string;
  };
}

export interface CreateIssueInput {
  projectKey: string;
  summary: string;
  description?: string;
  issueType: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  // Pass-through map for Jira custom fields (e.g., { customfield_10211: 10015 })
  customFields?: Record<string, any>;
}

export interface UpdateIssueInput {
  summary?: string;
  description?: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
  status?: string;
  // Pass-through map for Jira custom fields to update
  customFields?: Record<string, any>;
}

export interface JiraComment {
  id: string;
  body: string;
  author: {
    displayName: string;
    emailAddress: string;
  };
  created: string;
  updated: string;
}

export class JiraClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(config: JiraConfig) {
    this.baseUrl = config.baseUrl;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.personalAccessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    if (config.userAgent) {
      headers['User-Agent'] = config.userAgent;
    }
    
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/2`,
      headers
    });
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const response = await this.client.get(`/issue/${issueKey}`);
    return response.data;
  }

  async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssue[]> {
    const response = await this.client.post('/search', {
      jql,
      maxResults,
      fields: ['summary', 'status', 'assignee', 'reporter', 'priority', 'issuetype', 'created', 'updated', 'description']
    });
    return response.data.issues;
  }

  async createIssue(input: CreateIssueInput): Promise<JiraIssue> {
    const issueData: any = {
      fields: {
        project: {
          key: input.projectKey
        },
        summary: input.summary,
        issuetype: {
          name: input.issueType
        }
      }
    };

    if (input.description) {
      issueData.fields.description = input.description;
    }

    if (input.priority) {
      issueData.fields.priority = { name: input.priority };
    }

    if (input.assignee) {
      issueData.fields.assignee = { name: input.assignee };
    }

    if (input.labels && input.labels.length > 0) {
      issueData.fields.labels = input.labels;
    }

    if (input.components && input.components.length > 0) {
      issueData.fields.components = input.components.map(c => ({ name: c }));
    }

    // Merge any provided custom fields directly into the fields payload
    if (input.customFields && typeof input.customFields === 'object') {
      Object.assign(issueData.fields, input.customFields);
    }

    const response = await this.client.post('/issue', issueData);
    return await this.getIssue(response.data.key);
  }

  async updateIssue(issueKey: string, input: UpdateIssueInput): Promise<JiraIssue> {
    const updateData: any = {
      fields: {}
    };

    if (input.summary) {
      updateData.fields.summary = input.summary;
    }

    if (input.description !== undefined) {
      updateData.fields.description = input.description;
    }

    if (input.assignee) {
      updateData.fields.assignee = { name: input.assignee };
    }

    if (input.priority) {
      updateData.fields.priority = { name: input.priority };
    }

    if (input.labels) {
      updateData.fields.labels = input.labels;
    }

    // Merge any provided custom fields directly into the fields payload
    if (input.customFields && typeof input.customFields === 'object') {
      Object.assign(updateData.fields, input.customFields);
    }

    await this.client.put(`/issue/${issueKey}`, updateData);

    // Handle status transition separately if provided
    if (input.status) {
      await this.transitionIssue(issueKey, input.status);
    }

    return await this.getIssue(issueKey);
  }

  async transitionIssue(issueKey: string, statusName: string): Promise<void> {
    // Get available transitions
    const transitionsResponse = await this.client.get(`/issue/${issueKey}/transitions`);
    const transitions = transitionsResponse.data.transitions;

    // Find the transition that matches the desired status
    const transition = transitions.find((t: any) => 
      t.to.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!transition) {
      throw new Error(`No transition found to status: ${statusName}`);
    }

    await this.client.post(`/issue/${issueKey}/transitions`, {
      transition: {
        id: transition.id
      }
    });
  }

  async addComment(issueKey: string, comment: string): Promise<JiraComment> {
    const response = await this.client.post(`/issue/${issueKey}/comment`, {
      body: comment
    });
    return response.data;
  }

  async getComments(issueKey: string): Promise<JiraComment[]> {
    const response = await this.client.get(`/issue/${issueKey}/comment`);
    return response.data.comments;
  }

  async getProjects(): Promise<JiraProject[]> {
    const response = await this.client.get('/project');
    return response.data;
  }

  async getProject(projectKey: string): Promise<JiraProject> {
    const response = await this.client.get(`/project/${projectKey}`);
    return response.data;
  }

  async getIssueTypes(projectKey: string): Promise<any[]> {
    const response = await this.client.get(`/project/${projectKey}`);
    return response.data.issueTypes || [];
  }

  async getIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
    const response = await this.client.get('/issueLinkType');
    return response.data.issueLinkTypes || [];
  }

  async createIssueLink(input: CreateIssueLinkInput): Promise<Record<string, unknown>> {
    const resolvedIssueLinkType = await this.resolveIssueLinkType(input.relationship);
    const issueLinkData: any = {
      type: {
        id: resolvedIssueLinkType.issueLinkType.id,
      },
    };

    if (resolvedIssueLinkType.direction === 'outward') {
      issueLinkData.outwardIssue = { key: input.fromIssueKey };
      issueLinkData.inwardIssue = { key: input.toIssueKey };
    } else {
      issueLinkData.inwardIssue = { key: input.fromIssueKey };
      issueLinkData.outwardIssue = { key: input.toIssueKey };
    }

    if (input.comment?.trim()) {
      issueLinkData.comment = {
        body: input.comment.trim(),
      };
    }

    await this.client.post('/issueLink', issueLinkData);

    const createdIssueLink = await this.findIssueLink(input.fromIssueKey, input.toIssueKey, resolvedIssueLinkType);
    return {
      ...summarizeIssueLink(createdIssueLink),
      relationship: resolvedIssueLinkType.direction === 'outward'
        ? resolvedIssueLinkType.issueLinkType.outward
        : resolvedIssueLinkType.issueLinkType.inward,
      matchedBy: resolvedIssueLinkType.matchedBy,
    };
  }

  async deleteIssueLink(input: DeleteIssueLinkInput): Promise<Record<string, unknown>> {
    let issueLinkId = input.linkId?.trim();
    let deletedIssueLink: Record<string, unknown> | undefined;

    if (!issueLinkId) {
      if (!input.fromIssueKey || !input.toIssueKey || !input.relationship) {
        throw new Error('Deleting an issue link requires either linkId or fromIssueKey + toIssueKey + relationship.');
      }

      const resolvedIssueLinkType = await this.resolveIssueLinkType(input.relationship);
      const issueLink = await this.findIssueLink(input.fromIssueKey, input.toIssueKey, resolvedIssueLinkType);
      issueLinkId = issueLink.id;
      deletedIssueLink = {
        ...summarizeIssueLink(issueLink),
        relationship: resolvedIssueLinkType.direction === 'outward'
          ? resolvedIssueLinkType.issueLinkType.outward
          : resolvedIssueLinkType.issueLinkType.inward,
        matchedBy: resolvedIssueLinkType.matchedBy,
      };
    }

    await this.client.delete(`/issueLink/${issueLinkId}`);

    return deletedIssueLink
      ? {
          deletedLinkId: issueLinkId,
          deletedIssueLink,
        }
      : {
          deletedLinkId: issueLinkId,
        };
  }

  async assignIssue(issueKey: string, assignee: string): Promise<void> {
    await this.client.put(`/issue/${issueKey}/assignee`, {
      name: assignee
    });
  }

  async deleteIssue(issueKey: string): Promise<void> {
    await this.client.delete(`/issue/${issueKey}`);
  }

  async getCurrentUser(): Promise<any> {
    const response = await this.client.get('/myself');
    return response.data;
  }

  private async resolveIssueLinkType(relationship: string): Promise<ResolvedIssueLinkType> {
    if (!relationship?.trim()) {
      throw new Error('relationship is required to resolve an issue link type.');
    }

    const normalizedRelationship = normalizeIssueLinkRelationship(relationship);
    const issueLinkTypes = await this.getIssueLinkTypes();

    if (issueLinkTypes.length === 0) {
      throw new Error('No issue link types are available in Jira for the current user.');
    }

    for (const issueLinkType of issueLinkTypes) {
      if (normalizeIssueLinkRelationship(issueLinkType.outward) === normalizedRelationship) {
        return {
          issueLinkType,
          direction: 'outward',
          matchedBy: 'outward',
        };
      }
    }

    for (const issueLinkType of issueLinkTypes) {
      if (normalizeIssueLinkRelationship(issueLinkType.inward) === normalizedRelationship) {
        return {
          issueLinkType,
          direction: 'inward',
          matchedBy: 'inward',
        };
      }
    }

    for (const issueLinkType of issueLinkTypes) {
      if (normalizeIssueLinkRelationship(issueLinkType.name) === normalizedRelationship) {
        return {
          issueLinkType,
          direction: 'outward',
          matchedBy: 'name',
        };
      }
    }

    throw new Error(
      `Unknown issue link relationship: "${relationship}". Available link types: ${formatAvailableIssueLinkTypes(issueLinkTypes)}`
    );
  }

  private async findIssueLink(
    fromIssueKey: string,
    toIssueKey: string,
    resolvedIssueLinkType: ResolvedIssueLinkType
  ): Promise<JiraIssueLink> {
    const issue = await this.getIssue(fromIssueKey);
    const issueLinks = Array.isArray(issue.fields.issuelinks)
      ? issue.fields.issuelinks as JiraIssueLink[]
      : [];
    const normalizedTargetIssueKey = normalizeIssueKey(toIssueKey);

    const matchingIssueLink = issueLinks.find(issueLink => {
      if (!issueLinkMatchesType(issueLink, resolvedIssueLinkType.issueLinkType)) {
        return false;
      }

      const preferredTargetKey = resolvedIssueLinkType.direction === 'outward'
        ? getIssueLinkTargetKey(issueLink.outwardIssue)
        : getIssueLinkTargetKey(issueLink.inwardIssue);

      if (preferredTargetKey && normalizeIssueKey(preferredTargetKey) === normalizedTargetIssueKey) {
        return true;
      }

      const alternateTargetKey = resolvedIssueLinkType.direction === 'outward'
        ? getIssueLinkTargetKey(issueLink.inwardIssue)
        : getIssueLinkTargetKey(issueLink.outwardIssue);

      return !!alternateTargetKey && normalizeIssueKey(alternateTargetKey) === normalizedTargetIssueKey;
    });

    if (!matchingIssueLink) {
      throw new Error(
        `Issue link was not found after lookup for ${fromIssueKey} -> ${toIssueKey} (${resolvedIssueLinkType.issueLinkType.name}).`
      );
    }

    return matchingIssueLink;
  }
}
