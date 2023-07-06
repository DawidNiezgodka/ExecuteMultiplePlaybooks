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


    // TODO: handle requirements JSON
    // setup -> setup_requirements.yml
    // preload -> preload_requirements.yml etc
    const requirements = core.getInput('requirements');
    const privateKey = core.getInput('private_key');
    const inventory = core.getInput('inventory_file_path');
    const knownHosts = core.getInput('known_hosts');
    const extraOptions = core.getInput('extra_options');
    const sudo = core.getInput('sudo');

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
    const exeOrderArr = convertExeOrderStrToArray(executionOrder);
    console.log(`Execution order: ${exeOrderArr}`)

    // Extract the subdirectories of the playbook directory
    // Each subdirectory represents a benchmark phase
    const phaseDirs = await extractPhaseDirs(playbookDir);
    console.log(`Phase directories: ${phaseDirs}`);
    // Validate the execution order
    if(!isOrderIdentical(exeOrderArr, phaseDirs)) {
        core.setFailed('The execution order does not match the names of the phase directories');
        return;
    }

    const results = {};
    for (const playbook of exeOrderArr) {
      // Assumption: Each subdirectory contains a main.yml playbook which is the entrypoint
      // to the given phase's logic
      const currentPlaybook = path.join(playbookDir, playbook, 'main.yml');
      // ./playbook_dir/phase_dir/main.yml
      let cmd = prepareCommand(currentPlaybook, privateKey, inventory,
          knownHosts, extraOptions, sudo);

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
      results[playbook] = currOutput;

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
function convertExeOrderStrToArray(executionOrder) {
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


function prepareCommand(playbook, privateKey, inventory,
                        knownHosts, extraOptions, sudo) {

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

  // replaces all newline characters with a single space (\g replaces all occurrences)
  if (extraOptions) {
    commandComponents.push(extraOptions.replace(/\n/g, " "))
  }

  //  adds the elements "sudo", "-E", "env", and PATH=${process.env.PATH}
  //  to the front of the array,
  //  which modifies the command to be run with sudo and preserve the current env vars.
  if (sudo === 'true') {
    commandComponents.unshift("sudo", "-E", "env", `PATH=${process.env.PATH}`)
  }

  return commandComponents.join(" ")
}


function handleOptionalFile(inputFile, outputFileName, flagName, commandComponents) {
  if (inputFile) {
    const file = `.${outputFileName}`;
    fs.writeFile(file, file + os.EOL, { mode: 0o700 });
    core.saveState(outputFileName, file);
    commandComponents.push(`--${flagName}`);
    commandComponents.push(file);
  }
}

run();

module.exports = {
    convertExeOrderStrToArray,
    extractPhaseDirs,
    isOrderIdentical,
    prepareCommand,
    run
};
