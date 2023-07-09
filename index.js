const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml')

// The logic for running a single playbook is based on
// the idea presented in dawidd6/action-ansible-playbook
// See: https://github.com/dawidd6/action-ansible-playbook/blob/master/main.js
async function run() {
  try {
    // Read required inputs
    const ansible_dir = core.getInput('ansible_directory', { required: true });
    const playbookDir = core.getInput('playbook_directory', { required: true });
    const executionOrder = core.getInput('execution_order', { required: true });


    const requirements = core.getInput('requirements');
    const privateKey = core.getInput('private_key');
    const inventory = core.getInput('inventory_file_path');
    const knownHosts = core.getInput('known_hosts');
    const sudo = core.getInput('sudo');
    const extraOptions = core.getInput('extra_options');

    if (path.resolve(ansible_dir) !== path.resolve(process.cwd())) {
      console.log(`Changing directory to ${ansible_dir}`)
      process.chdir(ansible_dir);
      core.saveState("ansible_directory", ansible_dir);
    }

    if (requirements) {
      await handleRequirements(requirements);
    }

    // Split the execution order string into an array
    // Example: "a, b,   c" -> ["a", "b", "c"]
    const phaseOrder = convertExecutionOrderToPhaseArray(executionOrder);
    console.log(`Execution order: ${phaseOrder}`)

    // Extract the subdirectories of the playbook directory
    // Each subdirectory represents a benchmark phase
    const phaseDirs = await extractPhaseDirs(playbookDir);
    console.log(`Phase directories: ${phaseDirs}`);
    // Validate the execution order
    if(!isOrderIdentical(phaseOrder, phaseDirs)) {
        core.setFailed('The execution order does not match the names of the phase directories');
        return;
    }

    // Create a mapping between a phase name
    // and array of extra options for this particular phase
    // todo: if extra options exist
    const phaseNameToExtraOptions = parseExtraOptions(extraOptions);

    const extraOptionsForAllPhases = phaseNameToExtraOptions['all'] || [];
    // Assumption: Each subdirectory contains a main.yml playbook which is the entrypoint
    // to the given phase's logic
    const results = {};
    for (const phase of phaseOrder) {

      // TODO: check if the folder contains the file; if not, skip it
      // Example: ./playbook_dir/phase_dir/main.yml
      const currentPlaybook = path.join(playbookDir, phase, 'main.yml');

      // Check if phaseNameToExtraOptions contains extra options for the current phase
      const extraOptionsForGivenPhase = phaseNameToExtraOptions[phase] || [];
      let cmd = prepareCommand(currentPlaybook, privateKey, inventory, knownHosts, sudo,
          extraOptionsForAllPhases, extraOptionsForGivenPhase);

      console.log(`Running playbook ${currentPlaybook} with command: ${cmd}`);

      let currOutput = '';
      await exec.exec(cmd, null, {
        listeners: {
          stdout: function(data) {
            console.log("Writing to stdout");
            currOutput += data.toString()
          },
          stderr: function(data) {
            console.log("Writing to stderr");
            currOutput += data.toString()
          }
        }
      })
      results[phase] = currOutput;

    }
    core.setOutput('results', JSON.stringify(results));
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

async function handleRequirements(requirements) {
  const requirementsContent = fss.readFileSync(requirements, 'utf8')
  const requirementsObject = yaml.parse(requirementsContent)

  if (Array.isArray(requirementsObject)) {
    await exec.exec("ansible-galaxy", ["install", "-r", requirements])
  } else {
    if (requirementsObject.roles)
      await exec.exec("ansible-galaxy", ["role", "install", "-r", requirements])
    if (requirementsObject.collections)
      await exec.exec("ansible-galaxy", ["collection", "install", "-r", requirements])
  }
}

// String -> [String]
function convertExecutionOrderToPhaseArray(executionOrder) {
  console.log(`Converting the provided execution order: ${executionOrder}`)
  return executionOrder ? executionOrder.split(',').map(item => item.trim()) : [];
}

async function extractPhaseDirs(mainDirPath) {
  console.log(`Extracting phase directories from ${process.cwd()} and ${mainDirPath}`)
    const directories = await fs.readdir(mainDirPath, { withFileTypes: true });
    // Dirent[] -> String[]
    return directories
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
}

// [String] -> [String] -> Boolean
// First, check if the number of elements in the execution order array
// matches the number of phase directories.
// Then, check whether there is a match
// between the names of the elements in the execution order array and the names of phases
function isOrderIdentical(arr1, arr2) {
  console.log(`Checking whether the execution order is identical to the phase directories`)
  if (arr1.length !== arr2.length) {
    return false;
  }
  let sortedArr1 = [...arr1].sort();
  let sortedArr2 = [...arr2].sort();

  for (let i = 0; i < sortedArr1.length; i++) {
    if (sortedArr1[i] !== sortedArr2[i]) {
      return false;
    }
  }
  return true;
}



function parseExtraOptions(extraOptions) {
  const groupPattern = /<<(.+)>>\n([^<]+)/g;
  let groupNameToCommands = new Map();
  let match;

  while ((match = groupPattern.exec(extraOptions)) !== null) {
    let groupName = match[1];
    let commands = match[2].trim().split('\n');
    groupNameToCommands.set(groupName, commands);
  }

  return groupNameToCommands;
}


//       let cmd = prepareCommand(currentPlaybook, privateKey, inventory, knownHosts, sudo,
//           extraOptionsForAllPhases, extraOptionsForGivenPhase);
function prepareCommand(playbook, privateKey, inventory, knownHosts, sudo,
                        extraOptionsForAllPhases, extraOptionsForGivenPhase) {

  let commandComponents = ["ansible-playbook", playbook]

  // set private key
  handleOptionalFile(privateKey, "ansible_private_key", "private-key", commandComponents);

  //commandComponents.push(`--private-key ${privateKey}`)

  // set inventory
  handleOptionalFile(inventory, "ansible_inventory", "inventory", commandComponents);
  //commandComponents.push(`-i ${inventory}`)

  if (knownHosts) {
    const knownHostsFile = ".ansible_known_hosts"
    fs.writeFile(knownHostsFile, knownHosts, { mode: 0o600})
    core.saveState("knownHostsFile", knownHostsFile)
    commandComponents.push(`--ssh-common-args="-o UserKnownHostsFile=${knownHostsFile}"`)
    process.env.ANSIBLE_HOST_KEY_CHECKING = "True"
  } else {
    process.env.ANSIBLE_HOST_KEY_CHECKING = "False"
  }

  appendExtraOptions(commandComponents, extraOptionsForAllPhases);
  appendExtraOptions(commandComponents, extraOptionsForGivenPhase);

  //  adds the elements "sudo", "-E", "env", and PATH=${process.env.PATH}
  //  to the front of the array,
  //  which modifies the command to be run with sudo and preserve the current env vars.
  if (sudo === 'true') {
    commandComponents.unshift("sudo", "-E", "env", `PATH=${process.env.PATH}`)
  }

  return commandComponents.join(" ")
}

function appendExtraOptions(commandComponents, extraOptionsArray) {
  if (extraOptionsArray.length > 0) {
    let extraOptions = extraOptionsArray.join(" ");
    commandComponents.push(extraOptions);
  }
}


function handleOptionalFile(inputFile, outputFileName, flagName, commandComponents) {
  if (inputFile) {
    const file = `.${outputFileName}`;
    fss.writeFileSync(file, file + os.EOL, { mode: 0o600 });
    core.saveState(outputFileName, file);
    commandComponents.push(`--${flagName}`);
    commandComponents.push(file);
  }
}

run();

module.exports = {
    convertExeOrderStrToArray: convertExecutionOrderToPhaseArray,
    extractPhaseDirs,
    isOrderIdentical,
    prepareCommand,
    run
};
