#!/bin/bash

#check available commands
YUM_CMD=$(which yum)
APT_CMD=$(which apt)
APT_GET_CMD=$(which apt-get)
DNF_CMD=$(which dnf)
PKG_CMD=$(which pkg)
BREW_CMD=$(which brew)
NPM_CMD=$(which npm)


#install npm tool
if [[ -z NPM_CMD ]]; then
	if [[ ! -z $YUM_CMD ]]; then
		sudo yum install npm
	elif [[ ! -z $APT_CMD ]]; then
		sudo apt install npm
	elif [[ ! -z APT_GET_CMD ]]; then
		sudo apt-get install npm
	elif [[ ! -z $DNF_CMD ]]; then
		sudo dnf install npm
	elif [[ ! -z $PKG_CMD ]]; then
		sudo pkg install npm
	elif [[ ! -z BREW_CMD ]]; then
		brew install npm
	fi
fi

#install yarn and lateststable node.js
if [[ -z BREW_CMD ]]; then
  sudo npm install -g yarn
  sudo npm install -g n
  sudo n stable
fi	
