#!/bin/bash

# INFLUX_URL
# copy url from your web browser
# example INFLUX_URL=https://us-west-2-1.aws.cloud2.influxdata.com
#
# INFLUX_TOKEN
# generated token in the InfluxDB UI
# example INFLUX_TOKEN=h14b3X2n4kc8Q_jYPpwdjkv3dAZRorNQnN67pMwKs1lGgbMW8vWRjAi7VvkUitQMii2XwJM9qX3cnK4oAZDIjg==
#
# INFLUX_ORG
# typically your email - can be changed via UI or API
# example INFLUX_ORG=iotCenter@influxdata.com

export INFLUX_URL=
export INFLUX_TOKEN=
export INFLUX_ORG=

# export MQTT_TOPIC=iot_center
# export MQTT_URL=mqtt://localhost:1883

yarn dev
