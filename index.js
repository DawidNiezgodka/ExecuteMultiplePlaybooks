const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml')
const jsyaml = require('js-yaml');

// The logic for running a single playbook is based on
// the idea presented in dawidd6/action-ansible-playbook
// See: https://github.com/dawidd6/action-ansible-playbook/blob/master/main.js
async function run() {
  try {
    // Read required inputs
    const ansibleDir = core.getInput('ansible_directory');
    core.debug("Ansible dir is: " + ansibleDir);
    const playbookDir = core.getInput('playbook_directory');
    core.debug("Playbook dir is: " + playbookDir);
    // The execution order is a comma-separated list of phase names
    // In the context of this action, the provided execution order
    // is later called "phase order" (after converting the comma-separated list to an array)
    // Execution order: "a, b, c"
    // Phase order: ["a", "b", "c"]
    const executionOrder = core.getInput('execution_order', { required: true });
    // Read optional inputs
    const requirements = core.getInput('requirements');
    const privateKey = core.getInput('private_key');
    const inventory = core.getInput('inventory_file_path');
    const knownHosts = core.getInput('known_hosts');
    const sudo = core.getInput('sudo');
    const extraOptionsString = core.getInput('extra_options_string');
    const extraOptionsFile = core.getInput('extra_options_file');
    const secretsStr = core.getInput('secrets');
    const secrets = JSON.parse(secretsStr);

    // Change the current working directory to the ansible directory
    if (path.resolve(ansibleDir) !== path.resolve(process.cwd())) {
      console.log(`Changing directory to ${ansibleDir}`)
      process.chdir(ansibleDir);
      core.saveState("ansible_directory", ansibleDir);
    }

    console.log("PWD: " + process.cwd());

    if (requirements) {
      await handleRequirements(requirements);
    }

    // Split the execution order string into an array
    // to facilitates the further processing of each playbook in a loop
    // Example: "a, b,   c" -> ["a", "b", "c"]
    console.log("Printing execution order")
    const phaseOrder = convertExecutionOrderToPhaseArray(executionOrder);
    phaseOrder.forEach((phase) => {
        console.log("Phase: " + phase);
    });
    // Extract the subdirectories of the playbook directory
    // Each subdirectory represents a (benchmark) phase
    console.log("Printing all dirs in playbook dir");
    const allDirNames = await fetchAllDirNames(playbookDir);
    allDirNames.forEach((phase) => {
      console.log("Dirs: " + phase);
    });
    // Check whether the phases provided by the user match the phases represented
    // by the subdirectories of the playbook directory.
    // For example, if the user parovides "a, b, c" as the execution order,
    // then the playbook directory must contain subdirectories named "a", "b", and "c"
    if(!checkIfPlaybookDirHasRequiredDirs(phaseOrder, allDirNames)) {
        core.setFailed('The execution order does not match the names of the phase directories');
        return;
    }

    // Process the multiline input string and the file with additional options
    // to create a data structure that maps each phase name to a list of additional options
    let allExtraOptions = fetchExtraOptions(extraOptionsString, extraOptionsFile);
    // Replace escaped characters with actual values
    // TODO: Add a flag `withCustomEscapeChars` to the action's inputs
    // If false, skip the replacement of escaped characters

    // Check if allExtraOptions is not empty and not null
    if (allExtraOptions && allExtraOptions.size > 0) {
      console.log("Replacing escaped literals in extra options")
      allExtraOptions = replaceCustomEscapedLiteralsInMap(allExtraOptions, secrets);
    }

    // The main logic of the action - executing multiple playbooks
    // according to the provided execution order
    // and with the provided options
    const results = await executeMultiplePlaybooks(phaseOrder, playbookDir, privateKey,
        inventory, knownHosts, sudo, allExtraOptions);
    core.setOutput('results', JSON.stringify(results));

  }
  catch (error) {
    core.setFailed(error.message);
  }
}

/**
 * Processes the file with requirement. Logic taken from dawidd6/action-ansible-playbook
 * @param requirements the file with requirements
 * @returns {Promise<void>} a promise
 */
async function handleRequirements(requirements) {
  core.info(`Installing requirements from ${requirements}`)
  const requirementsContent = fss.readFileSync(requirements, 'utf8')
  const requirementsObject = yaml.parse(requirementsContent)

  if (Array.isArray(requirementsObject)) {
    core.debug("Installing requirements from a list");
    await exec.exec("ansible-galaxy", ["install", "-r", requirements])
  } else {
    if (requirementsObject.roles) {
      core.debug("Installing requirements from a roles section");
      await exec.exec("ansible-galaxy", ["role", "install", "-r", requirements])
    }
    if (requirementsObject.collections) {
        core.debug("Installing requirements from a collections section");
      await exec.exec("ansible-galaxy", ["collection", "install", "-r", requirements])
    }

  }
}

/**
 * Converts a string that represents an execution order to an array of strings,
 * where each string represents a phase name.
 * @param executionOrder a string that represents an execution order (action's input)
 * @returns {*|*[]} an array of strings, where each string represents a phase name
 * or an empty array if the provided execution order is empty
 */
function convertExecutionOrderToPhaseArray(executionOrder) {
  return executionOrder ? executionOrder.split(',').map(item => item.trim()) : [];
}


async function fetchAllDirNames(mainDirPath) {

  console.log("Main dir path: " + mainDirPath);
  console.log("Current working dir: " + process.cwd());

  const directories = await fs.readdir(mainDirPath, { withFileTypes: true });

  return directories
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
}

function checkIfPlaybookDirHasRequiredDirs(executionOrder, allDirs) {
  for (let elem of executionOrder) {
    if (!allDirs.includes(elem)) {
      return false;
    }
  }
  return true;
}

function fetchExtraOptions(extraOptionsString, extraOptionsFile) {
  if (!extraOptionsString && !extraOptionsFile) {
    console.log("No extra options provided")
    return new Map(); // Return an empty map
  }
  let processedExtraOptionsString;
  let processedExtraOptionsFile;

  // Process the multiline input parameter that contains additional options
  // for each phase's playbook.
  // The result of the processing is a data structure that maps each phase name
  // to a list of additional options.
  // Example: "setup" -> ["-private-key abc.key"]
  if (extraOptionsString) {
    processedExtraOptionsString = parseExtraOptionsString(extraOptionsString);
  }

  if (extraOptionsFile) {
    processedExtraOptionsFile = parseExtraOptionsFile(extraOptionsFile);
  }
  return mergeMaps(processedExtraOptionsString, processedExtraOptionsFile);
}

/**
 * Parses the multiline input parameter that contains additional options
 * @param extraOptions the multiline input parameter (string) that contains additional options
 * @returns {Map<any, any>} a data structure that maps each phase name to a list of additional options
 */
function parseExtraOptionsString(extraOptions) {
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

function parseExtraOptionsFile(yamlFilePath) {
  console.log("Parsing extra options file: " + yamlFilePath);
  const fileContents = fss.readFileSync(yamlFilePath, 'utf8');
  const yamlData = jsyaml.load(fileContents);

  let groupNameToCommands = new Map();

  for (let groupName in yamlData) {
    // eslint-disable-next-line no-prototype-builtins
    if (yamlData.hasOwnProperty(groupName)) {
      const commands = yamlData[groupName].options || [];
      groupNameToCommands.set(groupName, commands);
    }
    // Provide info about the number of parsed options for a given group
    console.log(`Parsed ${groupNameToCommands.get(groupName).length} options for group ${groupName}`);
  }

  return groupNameToCommands;
}

function mergeMaps(map1, map2) {
  if (!map1) {
      return map2;
  }
  if (!map2) {
      return map1;
  }
  let mergedMap = new Map();
  // Iterate over entries of the first map
  map1.forEach((value, key) => {
    if (map2.has(key)) {
      // If the key exists in both maps, merge the values and remove duplicates
      let mergedArray = [...new Set([...value, ...map2.get(key)])];
      mergedMap.set(key, mergedArray);
    } else {
      // If the key exists only in map1, add it to mergedMap
      mergedMap.set(key, value);
    }
  });

  map2.forEach((value, key) => {
    if (!map1.has(key)) {
      mergedMap.set(key, value);
    }
  });

  return mergedMap;
}

/**
 * Replace custom escaped strings in a command map with respective values from env or secrets.
 *
 * @param {Object} commandMap - The input map with phase names and arrays of commands.
 * @param {Object} secrets - An object containing the secrets, if any.
 * @returns {Object} - The transformed map.
 */
function replaceCustomEscapedLiteralsInMap(commandMap, secrets = {}) {
  const regex = /%\[\[\s*(env|secrets)\.(\w+)\s*]]/g;

  const transformedMap = new Map();

  commandMap.forEach((commands, phase) => {
    const transformedCommands = [];

    for (let i = 0; i < commands.length; i++) {
      let command = commands[i];

      let match;
      while ((match = regex.exec(command)) !== null) {
        const type = match[1];
        const key = match[2];

        if (type === "env") {
          command = command.replace(match[0], process.env[key] || match[0]);
        } else if (type === "secrets") {
          command = command.replace(match[0], secrets[key] || match[0]);
        }
      }

      transformedCommands.push(command);
    }

    transformedMap.set(phase, transformedCommands);
  });

  return transformedMap;
}



/**
 * Executes a number of playbooks according to the provided phase order.
 * @param phaseOrder the order in which the playbooks should be executed
 * @param playbookDir the directory that contains the playbooks, each playbook is located in a subdirectory
 * that represents a phase
 * @param privateKey ...
 * @param inventory ...
 * @param knownHosts known host configuration
 * @param sudo whether to use sudo
 * @param phaseNameToExtraOptions a data structure that maps each phase name to a list of additional options
 * @returns {Promise<{}>} the result of processing each playbook (a Map)
 */
async function executeMultiplePlaybooks(phaseOrder, playbookDir,
                                        privateKey, inventory, knownHosts, sudo,
                                        phaseNameToExtraOptions) {
  const results = {};
  for (const phase of phaseOrder) {

    const currentPlaybook = path.join(playbookDir, phase, 'main.yml');
    let cmd = prepareCommand(currentPlaybook, privateKey, inventory,
        knownHosts, sudo, phaseNameToExtraOptions, phase);

    console.log(`Running playbook ${currentPlaybook} with command: ${cmd}`);

    let currOutput = '';
    await exec.exec(cmd, null, {
      listeners: {
        stdout: function (data) {
          currOutput += data.toString()
        },
        stderr: function (data) {
          currOutput += data.toString()
        }
      }
    })
    results[phase] = currOutput;

  }
  return results;
}


/**
 * ...
 * @param playbook
 * @param privateKey
 * @param inventory
 * @param knownHosts
 * @param sudo
 * @param phaseNameToExtraOptions
 * @param phase
 * @returns {string}
 */
function prepareCommand(playbook, privateKey, inventory, knownHosts, sudo,
                        phaseNameToExtraOptions, phase) {

  let commandComponents = ["ansible-playbook", playbook]

  // set private key
  handleOptionalFile(privateKey, "ansible_private_key", "private-key", commandComponents);

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

  // check if phaseNameToExtraOptions is not empty and not null
  if (phaseNameToExtraOptions && phaseNameToExtraOptions.size > 0) {
    console.log(`Appending extra options for phase ${phase}`)
    appendExtraOptionsForGivenPhase(commandComponents, phaseNameToExtraOptions, phase);
    appendExtraOptionForWhichApplyToAllPhases(commandComponents, phaseNameToExtraOptions);
  }

  //  adds the elements "sudo", "-E", "env", and PATH=${process.env.PATH}
  //  to the front of the array,
  //  which modifies the command to be run with sudo and preserve the current env vars.
  if (sudo === 'true') {
    commandComponents.unshift("sudo", "-E", "env", `PATH=${process.env.PATH}`)
  }

  return commandComponents.join(" ")
}

function appendExtraOptionsForGivenPhase(commandComponents, phaseNameToExtraOptions, phase) {
  if (phaseNameToExtraOptions.has(phase)) {

    let commands = phaseNameToExtraOptions.get(phase);
    console.log(`Appending ${commands.length} extra options for phase ${phase}`)
    if (commands.length > 0) {
        commandComponents.push(...commands);
    }
  }
}

function appendExtraOptionForWhichApplyToAllPhases(commandComponents, phaseNameToExtraOptions) {
  if (phaseNameToExtraOptions.has('all')) {
    let commands = phaseNameToExtraOptions.get('all');
    if (commands.length > 0) {
      commandComponents.push(...commands);
    }
  }
}


function handleOptionalFile(inputFile, outputFileName, flagName, commandComponents) {
  if (inputFile) {
    const file = `.${outputFileName}`;
    fss.writeFileSync(file, file + os.EOL, { mode: 0o600});
    core.saveState(outputFileName, file);
    commandComponents.push(`--${flagName}`);
    commandComponents.push(file);
  }
}

run();

module.exports = {
    convertExeOrderStrToArray: convertExecutionOrderToPhaseArray,
    extractPhaseDirs: fetchAllDirNames,
    prepareCommand,
    run
};
