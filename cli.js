#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default Security List OCID for mercury-vnc VCN
const DEFAULT_SECURITY_LIST_ID = 'ocid1.securitylist.oc1.us-chicago-1.aaaaaaaawtdonyu4tmrbtfiam3y5peiblvf7jokxdubx2tzohptt7pkzcv3q';
const DEFAULTS_FILE_PATH = path.join(__dirname, 'defaults.json');

// Helper to print usage info
function printUsage() {
  console.log(`
Usage: ocloud-tools <command> [arguments] [options]

Commands:
  add <ip>      Allow ports 22, 80, and 443 for the specified IP address
  remove <ip>   Remove all ingress rules for the specified IP address
  reset         Reset all rules to the default status stored in defaults.json

Options:
  -s, --security-list-id <id>   Target Security List OCID (defaults to env OCI_SECURITY_LIST_ID or mercury-vnc SL)
  -k, --sdk                     Use OCI Node.js SDK instead of OCI CLI
  -h, --help                    Show this help message
`);
}

// IP Validator
function validateAndFormatIP(ipInput) {
  // Matches IPv4 with optional subnet mask
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]))?$/;
  if (!ipv4Regex.test(ipInput)) {
    console.error(`Error: Invalid IPv4 address format: "${ipInput}"`);
    process.exit(1);
  }
  return ipInput.includes('/') ? ipInput : `${ipInput}/32`;
}

// Execute command and return output or throw error
function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(error.stderr || error.message);
  }
}

// Convert kebab-case/snake_case to camelCase recursively
function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      acc[camelKey] = toCamelCase(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

// Check if OCI CLI is available in system PATH
function isOciCliAvailable() {
  try {
    execSync('oci --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Expand ~ to user's home directory
function expandTilde(filePath) {
  if (filePath && filePath.startsWith('~')) {
    const homeDir = os.homedir();
    return path.join(homeDir, filePath.slice(1));
  }
  return filePath;
}

// Parse OCI INI config file manually to handle custom paths and tilde expansion
function parseOciConfig(filePath, profileName = 'DEFAULT') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`OCI configuration file not found at ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  let currentSection = null;
  const config = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    const sectionMatch = trimmed.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    if (currentSection === profileName) {
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        config[key] = value;
      }
    }
  }

  return config;
}

// OciClient Abstraction Interface
class OciClient {
  async getRules(securityListId) {
    throw new Error('Not implemented');
  }
  async updateRules(securityListId, ingressRules, egressRules) {
    throw new Error('Not implemented');
  }
}

// CLI implementation of OciClient
class CliOciClient extends OciClient {
  async getRules(securityListId) {
    console.log(`[CLI] Fetching security list details for: ${securityListId}...`);
    const output = runCommand(`oci network security-list get --security-list-id ${securityListId}`);
    const parsed = JSON.parse(output);
    return {
      ingressRules: toCamelCase(parsed.data['ingress-security-rules'] || []),
      egressRules: toCamelCase(parsed.data['egress-security-rules'] || [])
    };
  }

  async updateRules(securityListId, ingressRules, egressRules) {
    const tempDir = os.tmpdir();
    const ingressFile = path.join(tempDir, `ingress-${Date.now()}.json`);
    const egressFile = path.join(tempDir, `egress-${Date.now()}.json`);

    try {
      fs.writeFileSync(ingressFile, JSON.stringify(ingressRules, null, 2));
      fs.writeFileSync(egressFile, JSON.stringify(egressRules, null, 2));

      console.log(`[CLI] Updating security list rules...`);
      runCommand(`oci network security-list update --security-list-id ${securityListId} --ingress-security-rules file://${ingressFile} --egress-security-rules file://${egressFile} --force`);
      console.log(`[CLI] Security list updated successfully.`);
    } finally {
      if (fs.existsSync(ingressFile)) fs.unlinkSync(ingressFile);
      if (fs.existsSync(egressFile)) fs.unlinkSync(egressFile);
    }
  }
}

// SDK implementation of OciClient
class SdkOciClient extends OciClient {
  constructor() {
    super();
    this.client = null;
  }

  async init() {
    if (this.client) return;

    console.log('[SDK] Loading OCI Node.js SDK modules...');
    const common = await import('oci-common');
    const core = await import('oci-core');

    const configFilePath = process.env.OCI_CONFIG_FILE || expandTilde('~/.oci/config');
    const profileName = process.env.OCI_CONFIG_PROFILE || 'DEFAULT';

    console.log(`[SDK] Reading OCI credentials from ${configFilePath} [profile: ${profileName}]...`);
    const config = parseOciConfig(configFilePath, profileName);

    if (!config.user || !config.tenancy || !config.fingerprint || !config.key_file || !config.region) {
      throw new Error(`Invalid or incomplete OCI config profile "${profileName}" in ${configFilePath}. Make sure user, tenancy, fingerprint, key_file, and region are specified.`);
    }

    const keyPath = expandTilde(config.key_file);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found at: ${keyPath} (resolved from key_file: ${config.key_file})`);
    }

    const privateKeyContent = fs.readFileSync(keyPath, 'utf-8');
    const region = common.Region.fromRegionId(config.region);

    const provider = new common.SimpleAuthenticationDetailsProvider(
      config.tenancy,
      config.user,
      config.fingerprint,
      privateKeyContent,
      config.passphrase || null,
      region
    );

    this.client = new core.VirtualNetworkClient({ authenticationDetailsProvider: provider });
  }

  async getRules(securityListId) {
    await this.init();
    console.log(`[SDK] Fetching security list details for: ${securityListId}...`);
    const response = await this.client.getSecurityList({ securityListId });
    const sl = response.securityList;
    return {
      ingressRules: toCamelCase(sl.ingressSecurityRules || []),
      egressRules: toCamelCase(sl.egressSecurityRules || [])
    };
  }

  async updateRules(securityListId, ingressRules, egressRules) {
    await this.init();
    console.log(`[SDK] Updating security list rules...`);
    await this.client.updateSecurityList({
      securityListId,
      updateSecurityListDetails: {
        ingressSecurityRules: ingressRules,
        egressSecurityRules: egressRules
      }
    });
    console.log(`[SDK] Security list updated successfully.`);
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // Parse security list ID option if provided
  let securityListId = process.env.OCI_SECURITY_LIST_ID || DEFAULT_SECURITY_LIST_ID;
  const slIndex = args.findIndex(arg => arg === '-s' || arg === '--security-list-id');
  if (slIndex !== -1 && slIndex + 1 < args.length) {
    securityListId = args[slIndex + 1];
    args.splice(slIndex, 2);
  }

  // Parse SDK flag
  let useSdk = process.env.USE_OCI_SDK === 'true';
  const sdkIndex = args.findIndex(arg => arg === '-k' || arg === '--sdk');
  if (sdkIndex !== -1) {
    useSdk = true;
    args.splice(sdkIndex, 1);
  }

  // Auto-detect OCI CLI availability
  if (!useSdk && !isOciCliAvailable()) {
    console.log('OCI CLI binary not found in PATH. Falling back to direct OCI Node.js SDK mode.');
    useSdk = true;
  }

  console.log(`Execution Mode: ${useSdk ? 'OCI Node.js SDK' : 'OCI CLI'}`);
  const client = useSdk ? new SdkOciClient() : new CliOciClient();

  const command = args[0];
  const ipParam = args[1];

  try {
    switch (command) {
      case 'add': {
        if (!ipParam) {
          console.error('Error: Please specify an IP address to add.');
          printUsage();
          process.exit(1);
        }
        const ip = validateAndFormatIP(ipParam);
        console.log(`Adding rules to allow ports 22, 80, and 443 for ${ip}...`);

        const { ingressRules, egressRules } = await client.getRules(securityListId);

        const portsToAllow = [22, 80, 443];
        let rulesAdded = 0;

        for (const port of portsToAllow) {
          // Check if rules for this IP and port already exist
          const exists = ingressRules.some(rule => 
            rule.protocol === '6' && // TCP
            rule.source === ip &&
            rule.tcpOptions &&
            rule.tcpOptions.destinationPortRange &&
            rule.tcpOptions.destinationPortRange.min === port &&
            rule.tcpOptions.destinationPortRange.max === port
          );

          if (!exists) {
            ingressRules.push({
              description: `Allow TCP port ${port} for ${ip}`,
              protocol: '6', // TCP
              source: ip,
              sourceType: 'CIDR_BLOCK',
              isStateless: false,
              tcpOptions: {
                destinationPortRange: {
                  min: port,
                  max: port
                },
                sourcePortRange: null
              },
              udpOptions: null,
              icmpOptions: null
            });
            rulesAdded++;
            console.log(`- Prepared rule to allow port ${port} for ${ip}`);
          } else {
            console.log(`- Rule to allow port ${port} for ${ip} already exists. Skipping.`);
          }
        }

        if (rulesAdded > 0) {
          await client.updateRules(securityListId, ingressRules, egressRules);
        } else {
          console.log('No new rules to add. Security list is already up to date.');
        }
        break;
      }

      case 'remove': {
        if (!ipParam) {
          console.error('Error: Please specify an IP address to remove.');
          printUsage();
          process.exit(1);
        }
        const ip = validateAndFormatIP(ipParam);
        console.log(`Removing all ingress rules for ${ip}...`);

        const { ingressRules, egressRules } = await client.getRules(securityListId);

        const filteredIngress = ingressRules.filter(rule => rule.source !== ip);
        const removedCount = ingressRules.length - filteredIngress.length;

        if (removedCount > 0) {
          console.log(`Removed ${removedCount} rule(s) matching source ${ip}.`);
          await client.updateRules(securityListId, filteredIngress, egressRules);
        } else {
          console.log(`No rules found matching source ${ip}.`);
        }
        break;
      }

      case 'reset': {
        console.log('Resetting security rules to defaults...');
        if (!fs.existsSync(DEFAULTS_FILE_PATH)) {
          console.error(`Error: Defaults configuration file not found at ${DEFAULTS_FILE_PATH}`);
          process.exit(1);
        }

        const defaults = JSON.parse(fs.readFileSync(DEFAULTS_FILE_PATH, 'utf-8'));
        const ingressRules = defaults.ingressSecurityRules || [];
        const egressRules = defaults.egressSecurityRules || [];

        await client.updateRules(securityListId, ingressRules, egressRules);
        break;
      }

      default:
        console.error(`Error: Unknown command: "${command}"`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('An error occurred during execution:', error.stack || error.message || error);
    process.exit(1);
  }
}

main();
