import * as core from '@actions/core';
import * as fs from 'fs';
import axios, { AxiosResponse } from 'axios';
import https from 'https';
import FormData from 'form-data';
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


async function run(): Promise<void> {
    try {
        // Input parameters with validation
        const apiToken = core.getInput('api_token', { required: true });
        if (!apiToken) {
            throw new Error('API token is required and cannot be empty');
        }
        core.setSecret(apiToken); // Mask the API token in logs

        const ownerName = sanitizeInput(core.getInput('owner_name', { required: true }));
        if (!ownerName) {
            throw new Error('Owner name is required and cannot be empty');
        }
        core.setSecret(ownerName); // Mask the owner name in logs

        const filePath = validateFilePath(core.getInput('file_path', { required: true }));

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
            core.warning(`File extension '${fileExtension}' might not be supported. Expected .ipa, .apk, or .aab`);
        }

        if (fileStats.size === 0) {
            throw new Error(`File is empty: ${filePath}`);
        }

        const message = sanitizeInput(core.getInput('message'));
        const distributionKey = sanitizeInput(core.getInput('distribution_key'));
        const distributionName = sanitizeInput(core.getInput('distribution_name'));
        const releaseNote = sanitizeInput(core.getInput('release_note'));

        // Convert string to boolean
        const disableNotifyInput = sanitizeInput(core.getInput('disable_notify'));
        const disableNotify = disableNotifyInput.toLowerCase() === 'true';

        // Log action parameters (masking sensitive data)
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
        const maxRetries = 1;
        let retryCount = 0;
        let lastError: Error | null = null;
        let response: AxiosResponse<UploadResponse> | undefined;

        const agent = new https.Agent({
            keepAlive: true,
        });
        while (retryCount < maxRetries) {
            try {
                response = await axios.post<UploadResponse>(
                    `https://deploygate.com/api/users/${ownerName}/apps`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            'Authorization': `Bearer ${apiToken}`,
                            'User-Agent': 'DeployGate-Upload-GitHub-Action/v1',
                        },
                        timeout: 900000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                        maxRedirects: 5,
                        httpsAgent: agent,
                        onUploadProgress: (progressEvent) => {
                            if (progressEvent.total) {
                                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                                core.info(`Upload progress: ${percentCompleted}%`);
                            }
                        },
                    }
                );
                // Break the loop if successful
                break;
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    core.setFailed(`Error Message: ${error.message}`);
                    core.setFailed(`Error Code: ${error.code || 'N/A'}`);
                    core.setFailed(`Error Status: ${error.response?.status || 'N/A'}`);
                    core.setFailed(`Error Status Text: ${error.response?.statusText || 'N/A'}`);
                    core.setFailed(`Error Response: ${JSON.stringify(error.response?.data || {}, null, 2)}`);
                    core.setFailed(`Error Config: ${JSON.stringify({
                        url: error.config?.url,
                        method: error.config?.method,
                        headers: error.config?.headers,
                        timeout: error.config?.timeout,
                    }, null, 2)}`);
                } else if (error instanceof Error) {
                    core.setFailed(`Error: ${error.message}`);
                    core.setFailed(`Error Stack: ${error.stack || 'N/A'}`);
                } else {
                    core.setFailed(`Unknown Error: ${String(error)}`);
                }
                lastError = error as Error;
                retryCount++;
                if (retryCount < maxRetries) {
                    const waitTime = Math.pow(2, retryCount) * 5000;
                    core.warning(`Upload failed, retrying in ${waitTime / 1000} seconds... (Attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        if (lastError && retryCount >= maxRetries) {
            throw lastError;
        }

        // Response processing
        if (response && response.data.error) {
            throw new Error(response.data.message || 'Upload failed');
        }

        core.info('Upload successful!');

        if (response && response.data.results) {
            const results = response.data.results;
            core.info(`App name: ${results.name}`);
            core.info(`Package name: ${results.package_name}`);
            core.info(`OS: ${results.os_name}`);
            core.info(`Version: ${results.version_name} (${results.version_code})`);

            // Mask the full download URL in logs but provide info
            if (results.file) {
                core.setSecret(results.file);
                core.info('Download URL is available in the outputs');
            }
        }

        // Set output as JSON string
        core.setOutput('results', JSON.stringify(response?.data.results));

    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                core.error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                core.error('No response received from DeployGate API. Check your network connection.');
            } else {
                core.error(`Error setting up request: ${error.message}`);
            }
            core.setFailed(`DeployGate upload failed: ${error.message}`);
        } else if (error instanceof Error) {
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
    // Remove any control characters
    return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

/**
 * Validate file path to prevent path traversal
 */
function validateFilePath(filePath: string): string {
    // Resolve to absolute path to prevent path traversal
    const resolvedPath = path.resolve(filePath);

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
    }

    // Check if it's a file and not a directory
    const fileStats = fs.statSync(resolvedPath);
    if (!fileStats.isFile()) {
        throw new Error(`Not a file: ${resolvedPath}`);
    }

    return resolvedPath;
}

run();