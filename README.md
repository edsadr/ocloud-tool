# ocloud-tools

A lightweight Node.js CLI utility leveraging the Oracle Cloud Infrastructure (OCI) CLI to manage IP-based ingress rules inside a Virtual Cloud Network (VCN) default security list.

## Prerequisites

1. **Node.js**: Ensure Node.js (v18+) is installed.
2. **OCI CLI**: The tool executes `oci` commands under the hood. You must have OCI CLI installed and authenticated.
   - Test by running: `oci iam region list`

## Installation

Clone the repository and install dependencies (if any):
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
