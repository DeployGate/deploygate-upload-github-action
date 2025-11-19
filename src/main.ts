import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import FormData from 'form-data';
import { request } from 'undici';
import * as path from 'path';

interface UploadResponse {
  error: boolean;
  message?: string;
  results?: {
    package_name: string;
    os_name: string;
    name: string;
    version_code: string;
    version_name: string;
    sdk_version: number;
    raw_sdk_version?: string;
    target_sdk_version: number | null;
    signature: string | null;
    message: string;
    file: string;
    icon: string;
    revision: number;
    path: string;
    [key: string]: any;
    user: {
      name: string;
      [key: string]: any;
    };
  };
}

interface PRComment {
  id: number;
  body: string;
}

interface GitHubComment {
  id: number;
  body: string;
  [key: string]: any;
}

async function run(): Promise<void> {
  try {
    // Input parameters with validation
    const apiToken = core.getInput('api_token', { required: true });
    if (!apiToken) {
      throw new Error('API token is required and cannot be empty');
    }
    core.setSecret(apiToken);

    const ownerName = sanitizeInput(core.getInput('owner_name', { required: true }));
    if (!ownerName) {
      throw new Error('Owner name is required and cannot be empty');
    }
    core.setSecret(ownerName);

    const filePath = validateFilePath(core.getInput('file_path', { required: true }));

    // Check if PR comment feature is enabled/disabled
    const enablePrComment = core.getInput('enable_pr_comment').toLowerCase() !== 'false';
    core.info(`PR comment feature is ${enablePrComment ? 'enabled' : 'disabled'}`);

    // File validation
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    if (!fileStats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    const fileExtension = path.extname(filePath).toLowerCase();
    if (!['.ipa', '.apk', '.aab'].includes(fileExtension)) {
      core.warning(
        `File extension '${fileExtension}' might not be supported. Expected .ipa, .apk, or .aab`
      );
    }

    if (fileStats.size === 0) {
      throw new Error(`File is empty: ${filePath}`);
    }

    const message = sanitizeInput(core.getInput('message'));
    const distributionKey = sanitizeInput(core.getInput('distribution_key'));
    const distributionName = sanitizeInput(core.getInput('distribution_name'));
    const releaseNote = sanitizeInput(core.getInput('release_note'));

    const disableNotifyInput = sanitizeInput(core.getInput('disable_notify'));
    const disableNotify = disableNotifyInput.toLowerCase() === 'true';

    // Log action parameters
    core.info(`File path: ${filePath}`);
    core.info(`File size: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`);
    core.info(`File type: ${fileExtension}`);

    if (message) core.info(`Message: ${message}`);
    if (distributionKey) core.info(`Distribution key: ${distributionKey}`);
    if (distributionName) core.info(`Distribution name: ${distributionName}`);
    if (releaseNote) core.info(`Release note length: ${releaseNote.length} characters`);
    core.info(`Disable notify: ${disableNotify}`);

    // FormData creation
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));

    if (message) formData.append('message', message);
    if (distributionKey) formData.append('distribution_key', distributionKey);
    if (distributionName) formData.append('distribution_name', distributionName);
    if (releaseNote) formData.append('release_note', releaseNote);
    formData.append('disable_notify', disableNotify.toString());

    core.info('Sending request to DeployGate API...');

    // Add retry logic
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: Error | null = null;
    let response: UploadResponse | undefined;

    while (retryCount < maxRetries) {
      try {
        const { statusCode, body } = await request(
          `https://deploygate.com/api/users/${ownerName}/apps`,
          {
            method: 'POST',
            headers: {
              ...formData.getHeaders(),
              Authorization: `Bearer ${apiToken}`,
              'User-Agent': 'DeployGate-Upload-GitHub-Action/v1',
            },
            body: formData,
          }
        );

        const responseData = (await body.json()) as UploadResponse;
        response = responseData;

        if (statusCode >= 400) {
          throw new Error(`HTTP Error: ${statusCode} - ${responseData.message || 'Unknown error'}`);
        }

        if (responseData.error) {
          throw new Error(responseData.message || 'Upload failed');
        }

        // Break the loop if successful
        break;
      } catch (error) {
        if (error instanceof Error) {
          core.setFailed(`Error: ${error.message}`);
          core.setFailed(`Error Stack: ${error.stack || 'N/A'}`);
        } else {
          core.setFailed(`Unknown Error: ${String(error)}`);
        }
        lastError = error as Error;
        retryCount++;
        if (retryCount < maxRetries) {
          const waitTime = Math.pow(2, retryCount) * 5000;
          core.warning(
            `Upload failed, retrying in ${waitTime / 1000} seconds... (Attempt ${retryCount}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    if (lastError && retryCount >= maxRetries) {
      throw lastError;
    }

    core.info('Upload successful!');

    if (response?.results) {
      const results = response.results;
      core.info(`App name: ${results.name}`);
      core.info(`Package name: ${results.package_name}`);
      core.info(`OS: ${results.os_name}`);
      core.info(`Version: ${results.version_name} (${results.version_code})`);

      if (results.file) {
        core.setSecret(results.file);
        core.info('Download URL is available in the outputs');
      }
    }

    // Set output as JSON string
    core.setOutput('results', JSON.stringify(response?.results));

    if (enablePrComment) {
      await updateOrCreateComment(response?.results);
    } else {
      core.info('Skipping PR comment creation as it is disabled');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

/**
 * Sanitize input to prevent injection attacks
 */
function sanitizeInput(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

/**
 * Validate file path to prevent path traversal
 */
function validateFilePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  const fileStats = fs.statSync(resolvedPath);
  if (!fileStats.isFile()) {
    throw new Error(`Not a file: ${resolvedPath}`);
  }
  return resolvedPath;
}

async function findExistingComment(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRComment | null> {
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const deployGateComment = comments.find((comment: GitHubComment) =>
      comment.body.includes('## DeployGate Upload Information')
    );

    return deployGateComment ? { id: deployGateComment.id, body: deployGateComment.body } : null;
  } catch (error) {
    core.warning(`Failed to fetch comments: ${error}`);
    return null;
  }
}

async function updateOrCreateComment(results: any): Promise<void> {
  try {
    const token = core.getInput('github_token', { required: true });
    const octokit = github.getOctokit(token);
    const context = github.context;

    if (!context.payload.pull_request) {
      core.info('Not a pull request. Skipping comment creation.');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    let qrCodeUrl = '';

    core.info(`Distribution URL: ${results.distribution?.url}`);

    if (results.distribution?.url) {
      core.info('Generating QR code URL...');
      qrCodeUrl = `https://deploygate.com/qr?size=178&data=${encodeURIComponent(results.distribution.url)}`;
      core.info(`Generated QR code URL: ${qrCodeUrl}`);
    } else {
      core.info('No distribution URL found');
    }

    const commentBody = `## DeployGate Upload Information

| Item | Content |
|:---|:---|
| 🔄 Revision | \`${results.revision}\` |
| 📱 App Details | [View on DeployGate](${results.revision_url}) |${
      results.distribution?.url
        ? `
| 🔗 Distribution Page | [${results.distribution.url}](${results.distribution.url}) |
| 📲 Open on Mobile | ![QR Code](${qrCodeUrl}) |`
        : ''
    }`;

    core.info('Comment body preview:');
    core.info(commentBody);

    const existingComment = await findExistingComment(
      octokit,
      context.repo.owner,
      context.repo.repo,
      prNumber
    );

    if (existingComment) {
      await octokit.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existingComment.id,
        body: commentBody,
      });
      core.info('Updated existing comment');
    } else {
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: commentBody,
      });
      core.info('Created new comment');
    }
  } catch (error) {
    core.warning(`Failed to update/create comment: ${error}`);
  }
}

run();
