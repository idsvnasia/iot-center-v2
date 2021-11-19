#!/bin/bash

packageInstall () {
  echo "================"
  echo "Installing $1..."
  if [[ ! -z $YUM_CMD ]]; then
    sudo yum install $1
  elif [[ ! -z $APT_CMD ]]; then
    sudo apt install $1
  elif [[ ! -z $APT_GET_CMD ]]; then
    sudo apt-get install $1
  elif [[ ! -z $DNF_CMD ]]; then
    sudo dnf install $1
  elif [[ ! -z $PKG_CMD ]]; then
    sudo pkg install $1
  elif [[ ! -z $BREW_CMD ]]; then
    brew install $1
  else
    echo "Error: cannot install $1 - unknow package manager!"
  fi
}

#check available commands
YUM_CMD=$(which yum)
APT_CMD=$(which apt)
APT_GET_CMD=$(which apt-get)
DNF_CMD=$(which dnf)
PKG_CMD=$(which pkg)
BREW_CMD=$(which brew)
NPM_CMD=$(which npm)
MQTT_CMD=$(which mosquitto)

#macOS - install yarn and mosquitto only
if [[ ! -z $BREW_CMD ]]; then
  brew install yarn
  brew install mosquitto
  exit
fi

#install npm tool
if [[ -z $NPM_CMD ]]; then
  packageInstall "npm"
fi

#install mosquitto tool
if [[ -z $MQTT_CMD ]]; then
  packageInstall "mosquitto"
fi

#install yarn and the latest stable node.js
if [[ -z $BREW_CMD ]]; then
  echo "Installing yarn tool..."
  sudo npm install -g yarn
  echo "Installing node tool..."
  sudo npm install -g n
  sudo n stable
fi
