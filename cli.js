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

// Load security list from OCI
function getSecurityList(securityListId) {
  console.log(`Fetching security list details for: ${securityListId}...`);
  const output = runCommand(`oci network security-list get --security-list-id ${securityListId}`);
  const parsed = JSON.parse(output);
  return parsed.data;
}

// Update security list on OCI
function updateSecurityList(securityListId, ingressRules, egressRules) {
  const tempDir = os.tmpdir();
  const ingressFile = path.join(tempDir, `ingress-${Date.now()}.json`);
  const egressFile = path.join(tempDir, `egress-${Date.now()}.json`);

  try {
    fs.writeFileSync(ingressFile, JSON.stringify(ingressRules, null, 2));
    fs.writeFileSync(egressFile, JSON.stringify(egressRules, null, 2));

    console.log(`Updating security list rules...`);
    runCommand(`oci network security-list update --security-list-id ${securityListId} --ingress-security-rules file://${ingressFile} --egress-security-rules file://${egressFile} --force`);
    console.log(`Security list updated successfully.`);
  } finally {
    if (fs.existsSync(ingressFile)) fs.unlinkSync(ingressFile);
    if (fs.existsSync(egressFile)) fs.unlinkSync(egressFile);
  }
}

// Main function
function main() {
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
    // Remove the flag and value from positional arguments
    args.splice(slIndex, 2);
  }

  const command = args[0];
  const ipParam = args[1];

  switch (command) {
    case 'add': {
      if (!ipParam) {
        console.error('Error: Please specify an IP address to add.');
        printUsage();
        process.exit(1);
      }
      const ip = validateAndFormatIP(ipParam);
      console.log(`Adding rules to allow ports 22, 80, and 443 for ${ip}...`);

      const currentList = getSecurityList(securityListId);
      const ingressRules = toCamelCase(currentList['ingress-security-rules'] || []);
      const egressRules = toCamelCase(currentList['egress-security-rules'] || []);

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
        updateSecurityList(securityListId, ingressRules, egressRules);
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

      const currentList = getSecurityList(securityListId);
      const ingressRules = toCamelCase(currentList['ingress-security-rules'] || []);
      const egressRules = toCamelCase(currentList['egress-security-rules'] || []);

      const filteredIngress = ingressRules.filter(rule => rule.source !== ip);
      const removedCount = ingressRules.length - filteredIngress.length;

      if (removedCount > 0) {
        console.log(`Removed ${removedCount} rule(s) matching source ${ip}.`);
        updateSecurityList(securityListId, filteredIngress, egressRules);
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

      updateSecurityList(securityListId, ingressRules, egressRules);
      break;
    }

    default:
      console.error(`Error: Unknown command: "${command}"`);
      printUsage();
      process.exit(1);
  }
}

main();
