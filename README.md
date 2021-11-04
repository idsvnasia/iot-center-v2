# IoT Center v2

This repository contains the IoT Center application that provides a web UI that shows how to use InfluxDB v2 in various use cases. 
It also contains independent clients that write into InfluxDB.

## Features

* simple device management, automatic registration of devices in InfluxDB
* arduino, pyton, javasript clients
* various data visualizations, dashboards

## Quick Start

* Prerequisites
   * node 12 or newer
   * yarn 1.9.4 or newer

### Run IoT Center Application

#### From Source
```
cd app
yarn install
yarn build
yarn start
open http://localhost:5000
```

or

```
docker-compose up
open http://localhost:5000
```

#### Docker

Docker images are available on [GitHub Packages](https://github.com/bonitoo-io/iot-center-v2/packages) with `nightly` tag:

```
docker pull docker.pkg.github.com/bonitoo-io/iot-center-v2/iot-center:nightly

docker run \
  --name iot-center \
  --detach \
  --env INFLUX_URL=http://10.100.10.100:9999 \
  --env INFLUX_TOKEN=my-token \
  --env INFLUX_ORG=my-org \
  --publish 5000:5000 \
  docker.pkg.github.com/bonitoo-io/iot-center-v2/iot-center:nightly
```

##### Authenticating to GitHub Packages with personal access token

You must use a personal access token with the appropriate scopes to use image from GitHub Packages. 

For more information, see "[Authenticating with a personal access token](https://docs.github.com/en/packages/using-github-packages-with-your-projects-ecosystem/configuring-docker-for-use-with-github-packages#authenticating-with-a-personal-access-token)".
```
cat ~/TOKEN.txt | docker login https://docker.pkg.github.com -u USERNAME --password-stdin
```

### Develop and Play with IoT Center Application (hot-swap enabled)

```
cd app
yarn install
yarn dev
```

### Realtime demo

#### Only mqtt (locally)

each line in separate terminal, no environment variables has to be set:
```
cd app/server/mqtt/docker-mosquitto && ./run_mqtt_server.sh
cd app/server && yarn mqtt_dev
cd app/ui && yarn start
```
Application is running at `http://localhost:3000/realtime`

Mqtt can be checked with
```
cd app/server && yarn mqtt_subscriber
```

#### mqtt with influx

##### setup
Register account in InfluxDB Cloud 2 if not exists or install local InfluxDB 2 instance

Edit `app/dev.sh` and set environment values `INFLUX_TOKEN`, `INFLUX_URL`, `INFLUX_ORG` and uncomment `MQTT_TOPIC`, `MQTT_URL` *(MQTT_URL can't be localhost or 127.0.0.1 to run with real devices)*

Install telegraf and copy example configuration:
```
cd app/server/mqtt
cp -n telegraf.example.conf telegraf.conf
```
Edit `telegraf.conf` and set `urls`, `token`, `organization` under `[[outputs.influxdb_v2]]` and `servers`, `iot_center` under `[[inputs.mqtt_consumer]]` *(to be same as in app/dev.sh)*:
```
nano telegraf.conf
```

##### Run everything

Have MQTT Running public or run locally with command: 
```
cd app/server/mqtt/docker-mosquitto && ./run_mqtt_server.sh
```

Start telgraf: 
```
cd app/server/mqtt && telegraf --config telegraf.conf
```

Start app:
```
cd app && ./dev.sh
```

Mqtt can be checked with:
```
cd app/server && yarn mqtt_subscriber
```

Open browser at `http://localhost:3000/realtime`:
```
xdg-open http://localhost:3000/realtime
```


### Environment Installation

* Install latest node.js
* Install latest yarn
* Download this GIT repository
* Install local InfluxDB 2 instance or register account in InfluxDB Cloud 2 if not exists
* Create admin token
* Set environment variable INFLUX_TOKEN with the admin token from the previous point
* Set environment variable INFLUX_URL (do not use localhost or 127.0.0.1 - IoT Devices need external address)
* Set environment variable INFLUX_ORG
* Run IoT Center

## License

The project is under the [MIT License](https://opensource.org/licenses/MIT).
