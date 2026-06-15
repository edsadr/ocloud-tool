# ocloud-tools

A lightweight Node.js CLI utility to manage IP-based ingress rules inside a Virtual Cloud Network (VCN) default security list.

## Prerequisites

1. **Node.js**: Ensure Node.js (v18+) is installed.
2. **OCI Authentication**: The tool supports two execution modes:
   - **OCI CLI Mode (Default)**: Leverages your local `oci` CLI executable.
   - **OCI SDK Mode**: Interacts directly with OCI via the official Node.js SDK (useful in environments where the OCI CLI is not installed).
   
   Both modes use your OCI configuration file (typically at `~/.oci/config`).

## Authentication & Credentials

To authenticate requests, the tool expects your OCI API credentials to be configured in an OCI configuration file located at `~/.oci/config` on Linux/macOS, or `%USERPROFILE%\.oci\config` on Windows.

### Configuration File Format
The config file must contain a `[DEFAULT]` profile with the following parameters:

```ini
[DEFAULT]
user=ocid1.user.oc1..aaaaaaaaxxxxxxx
fingerprint=aa:bb:cc:dd:ee:ff:11:22:33:44:55:66:77:88:99:00
key_file=/home/username/.oci/oci_api_key.pem
tenancy=ocid1.tenancy.oc1..aaaaaaaaxxxxxxx
region=us-chicago-1
```

- **user**: The OCID of the OCI IAM user.
- **fingerprint**: The fingerprint of the public API key uploaded to the OCI Console for this user.
- **key_file**: The absolute path to your private RSA key file (`.pem` format).
- **tenancy**: The OCID of your OCI tenancy.
- **region**: The target OCI region (e.g., `us-chicago-1`).

## Installation

Clone the repository and install dependencies:
```bash
git clone git@github.com:edsadr/ocloud-tool.git
cd ocloud-tools
pnpm install
```

Make the script executable:
```bash
chmod +x cli.js
```

## Configuration

By default, the tool targets the security list:
`ocid1.securitylist.oc1.us-chicago-1.aaaaaaaawtdonyu4tmrbtfiam3y5peiblvf7jokxdubx2tzohptt7pkzcv3q`

You can override this target using either:
- The environment variable: `OCI_SECURITY_LIST_ID`
- The CLI option: `-s` or `--security-list-id`

To force OCI SDK execution mode, you can:
- Use the CLI option: `-k` or `--sdk`
- Set the environment variable: `USE_OCI_SDK=true`

*Note: If the `oci` CLI binary is not found in your system PATH, the tool automatically falls back to direct OCI Node.js SDK mode.*

The baseline/default state rules are maintained in `defaults.json`.

## Usage

Run the commands via `node cli.js` or `pnpm start`:

### 1. Show Help
```bash
node cli.js --help
```

### 2. Allow IP Address
Adds ingress TCP rules allowing traffic from the specified IP on ports **22**, **80**, and **443**:
```bash
node cli.js add 198.51.100.42
```
*Note: If some or all of the rules already exist, the command will skip duplicates.*

To force SDK mode:
```bash
node cli.js add 198.51.100.42 --sdk
```

### 3. Remove IP Address
Removes all ingress rules corresponding to the specified source IP:
```bash
node cli.js remove 198.51.100.42
```

### 4. Reset to Defaults
Resets the security list's rules to match the baseline configuration defined in `defaults.json`:
```bash
node cli.js reset
```

