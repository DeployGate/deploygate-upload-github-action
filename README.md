# DeployGate Upload GitHub Action

This action is for uploading application files to DeployGate. 
For more details, please refer to the following documentation: https://docs.deploygate.com/docs/api/application/upload

## Usage

Set up and use in your workflow file as follows:

```yaml
name: Deploy to DeployGate Example

on:
  pull_request:
    branches:
      - main
    types: [opened, synchronize]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Upload to DeployGate
        uses: DeployGate/deploygate-upload-github-action@v1.0.2
        with:
          api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
          owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
          file_path: /path/to/app_file
          message: "message example"
```

## Versioning

This action follows [Semantic Versioning](https://semver.org/). Version numbers are structured as MAJOR.MINOR.PATCH:

- MAJOR version changes indicate incompatible API changes
- MINOR version changes add functionality in a backwards compatible manner
- PATCH version changes include backwards compatible bug fixes

### Version Reference

When using this action, we recommend using the full version number (e.g., `@1.0.1`) rather than a major or minor version number (e.g., `@v1` or `@v1.0`). This ensures:

- Consistent behavior in your workflows
- Protection against unexpected breaking changes
- Easier tracking of version-specific issues

Example:
```yaml
- uses: DeployGate/deploygate-upload-github-action@v1.0.2
```

## Input parameters

| Parameter | Required | Description |
|------------|------|------|
| `api_token` | ✅ | DeployGate API token (Recommended to use GitHub Secrets) |
| `owner_name` | ✅ | User name or Organization name (Recommended to use GitHub Secrets) |
| `file_path` | ✅ | App's binary file path (IPA/APK/AAB) |
| `message` | ❌ | Description of uploaded file |
| `distribution_key` | ❌ | Distribution page's hash |
| `distribution_name` | ❌ | Distribution page's name |
| `release_note` | ❌ | Message displayed during distribution page app updates |
| `disable_notify` | ❌ | (iOS only) Disable Push notification emails |
| `enable_pr_comment` | ❌ | Enable/Disable PR comment creation (Default: true) |

## Output

| Output | Description |
|------|------|
| `results` | DeployGate API response results |

## License

MIT License

## Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add some amazing feature'`)
4. Push the branch (`git push origin feature/amazing-feature`)
5. Create a pull request

## Maintenance

This action uses [Dependabot](https://docs.github.com/ja/code-security/dependabot) to keep dependencies up to date. Security updates are applied automatically.

## Examples

### Basic Usage
```yaml
- name: Upload to DeployGate
  uses: DeployGate/deploygate-upload-github-action@v1.0.2
  with:
    api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
    owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
    file_path: /path/to/app_file
    message: "PR #${{ github.event.pull_request.number }} - ${{ github.event.pull_request.title }}"
    distribution_name: "PR #${github.event.pull_request.number}"
    enable_pr_comment: true
```

### Using Action Outputs
```yaml
- name: Upload to DeployGate
  id: deploygate
  uses: DeployGate/deploygate-upload-github-action@v1.0.2
  with:
    api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
    owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
    file_path: /path/to/app_file

- name: Use Upload Results
  run: |
    # Access the entire results object
    echo "Full results: ${{ steps.deploygate.outputs.results }}"
    
    # Access specific values using fromJSON
    echo "App name: ${{ fromJSON(steps.deploygate.outputs.results).name }}"
    echo "Package name: ${{ fromJSON(steps.deploygate.outputs.results).package_name }}"
    echo "Download URL: ${{ fromJSON(steps.deploygate.outputs.results).file }}"
```

### Build and Upload iOS App
```yaml
name: Build and Deploy iOS App

on:
  pull_request:
    branches: [ main ]
    types: [opened, synchronize]

jobs:
  build-and-upload:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build iOS App
        run: |
          xcodebuild -workspace YourApp.xcworkspace \
                     -scheme YourScheme \
                     -configuration Debug \
                     -archivePath $RUNNER_TEMP/YourApp.xcarchive \
                     clean archive
          xcodebuild -exportArchive \
                     -archivePath $RUNNER_TEMP/YourApp.xcarchive \
                     -exportOptionsPlist exportOptions.plist \
                     -exportPath $RUNNER_TEMP/export

      - name: Upload to DeployGate
        id: deploygate
        uses: DeployGate/deploygate-upload-github-action@v1.0.2
        with:
          api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
          owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
          file_path: ${{ runner.temp }}/export/YourApp.ipa
          message: "PR #${{ github.event.pull_request.number }}"
          distribution_name: "PR #${github.event.pull_request.number}"
```

### Build and Upload Android App (AAB) (Recommended)
```yaml
name: Build and Deploy Android App (AAB)

on:
  pull_request:
    branches: [ main ]
    types: [opened, synchronize]

jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Build Release Bundle
        run: ./gradlew bundleRelease

      - name: Upload AAB to DeployGate
        id: deploygate
        uses: DeployGate/deploygate-upload-github-action@v1.0.2
        with:
          api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
          owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
          file_path: app/build/outputs/bundle/release/app-release.aab
          message: "PR #${{ github.event.pull_request.number }} - ${{ github.event.pull_request.title }}"
          distribution_name: "PR #${github.event.pull_request.number}"
          release_note: |
            Branch: ${{ github.head_ref }}
            Commit: ${{ github.sha }}
```

### Build and Upload Android App (APK)
```yaml
name: Build and Deploy Android App (APK)

on:
  pull_request:
    branches: [ main ]
    types: [opened, synchronize]

jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Build Release APK
        run: ./gradlew assembleRelease

      - name: Upload APK to DeployGate
        id: deploygate
        uses: DeployGate/deploygate-upload-github-action@v1.0.2
        with:
          api_token: ${{ secrets.DEPLOYGATE_API_TOKEN }}
          owner_name: ${{ secrets.DEPLOYGATE_OWNER_NAME }}
          file_path: app/build/outputs/apk/release/app-release.apk
          message: "PR #${{ github.event.pull_request.number }} - ${{ github.event.pull_request.title }}"
          distribution_name: "PR #${github.event.pull_request.number}"
          release_note: |
            Branch: ${{ github.head_ref }}
            Commit: ${{ github.sha }}
```

## Output Structure

The `results` output contains the following structure:

```json
{
  "name": "App Name",
  "package_name": "com.example.app",
  "os_name": "android or ios",
  "path": "/path/to/app",
  "revision": 1,
  "version_code": "1",
  "version_name": "1.0.1",
  "sdk_version": 30,
  "target_sdk_version": "30",
  "message": "Upload message",
  "file": "https://deploygate.com/path/to/file",
  "icon": "https://deploygate.com/path/to/icon",
  "user": {
    "name": "username",
  }
}
```

You can access these values in your workflow using the `fromJSON` function as shown in the examples above.

