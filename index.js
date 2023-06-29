const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const path = require('path');

// The logic for running a single playbook is based on
// the idea presented in dawidd6/action-ansible-playbook
// See: https://github.com/dawidd6/action-ansible-playbook/blob/master/main.js
async function run() {
  try {
    // Read required inputs
    const playbookDir = core.getInput('playbook_directory', { required: true });
    const privateKeyPath = core.getInput('private_key_path', { required: true });
    const executionOrder = core.getInput('execution_order', { required: true })


    // TODO: handle requirements JSON
    // setup -> setup_requirements.yml
    // preload -> preload_requirements.yml etc
    // const requirements = JSON.parse(core.getInput('requirements'));
    const extraOptions = core.getInput('extra_options');
    const sudo = core.getInput('sudo');

    // Split the execution order string into an array
    // Example: "a, b,   c" -> ["a", "b", "c"]
    const exeOrderArr = convertExeOrderStrToArray(executionOrder);

    // Extract the subdirectories of the playbook directory
    // Each subdirectory represents a benchmark phase
    const phaseDirs = await extractPhaseDirs(playbookDir);

    // Validate the execution order
    if(!isOrderIdentical(exeOrderArr, phaseDirs)) {
        core.setFailed('The execution order does not match the names of the phase directories');
        return;
    }

    const results = {};
    for (const playbook of executionOrder) {
      // Assumption: Each subdirectory contains a main.yml playbook which is the entrypoint
      // to the given phase's logic
      const currentPlaybook = path.join(playbookDir, playbook, 'main.yml');
      // ./playbook_dir/phase_dir/main.yml
      let cmd = prepareCommand(currentPlaybook, privateKeyPath, extraOptions, sudo);

      let currOutput = '';
      await exec.exec(cmd, null, {
        listeners: {
          stdout: function(data) {
            currOutput += data.toString()
          },
          stderr: function(data) {
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

// String -> [String]
function convertExeOrderStrToArray(executionOrder) {
  return executionOrder.split(',').map(item => item.trim());
}

async function extractPhaseDirs(mainDirPath) {
    const directories = await fs.readdir(mainDirPath, { withFileTypes: true });
    return directories
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
}

// [String] -> [String] -> ()
// First, check if the number of elements in the execution order array
// matches the number of phase directories.
// Then, check whether there is a match
// between the names of the elements in the execution order array and the names of phases
function isOrderIdentical(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    return false;
  }

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
}


async function prepareCommand(playbook, privateKeyPath, galaxyRequirements,
                        extraOptions, sudo) {
  let commandComponents = ["ansible-playbook", playbook]

  // set private key
  commandComponents.push(`--private-key ${privateKeyPath}`)

  // replaces all newline characters with a single space (\g replaces all occurrences)
  if (extraOptions) {
    commandComponents.push(extraOptions.replace(/\n/g, " "))
  }

  //  adds the elements "sudo", "-E", "env", and PATH=${process.env.PATH}
  //  to the front of the array,
  //  which modifies the command to be run with sudo and preserve the current env vars.
  if (sudo) {
    commandComponents.unshift("sudo", "-E", "env", `PATH=${process.env.PATH}`)
  }

  return commandComponents.join(" ")
}

run();
