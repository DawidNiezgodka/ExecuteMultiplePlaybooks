This action allows you to run multiple Ansible Playbooks in a specific order.
Running the playbooks in the desired sequence can be achieved by:

1. Prompting the user to provide the value of input named `execution_order`, which represents the order.
2. Structuring the project appropriately, namely:  
   a) placing a folder with playbooks within the main Ansible folder, for example `Ansible/playbooks`  
   b) dividing this folder into subfolders in such a way that each subfolder represents one of the phases specified in the first point

Example:
1. `execution_order` = `setup,preload,run,analysis`
2. Project structure:
```
.
├── ansible
│   ├── group_vars
│   │   ├── sut-master.yml
│   │   ├── sut-slave.yml
│   │   └── wg.yml
│   ├── hosts.cfg
│   ├── playbooks
│   │   ├── analysis
│   │   │   └── main.yml
│   │   ├── preload
│   │   │   └── main.yml
│   │   ├── run
│   │   │   └── main.yml
│   │   └── setup
│   │       └── main.yml
```

As you can see, there is a match between the phases in the string provided by the user and the names of the subfolders. Please note that the order of the subfolders is not important. The action will run the playbooks in the order specified by the user.
What is relevant is that the names of the subfolders match the names of the phases (`execution_order`) provided by the user.

## Features

- Runs multiple Ansible playbooks in a specific order
- Verifies that there is a match between the order named in the `execution_order` and the names of the subfolders in the `playbooks` folder

## Credits
The idea of how to run a single Ansible playbook was based on the following action: https://github.com/dawidd6/action-ansible-playbook
