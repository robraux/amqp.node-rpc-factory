'use strict';

var amqp = require('amqplib'),
  _ = require('lodash'),
  q = require('q');

var rpcConsumerProto = {

  logInfo: function(msg) {
    console.log(msg);
  },

  logError: function(msg) {
    console.log(msg);
  },

  uri: function () {
    if(this.url.slice(0, 7) == 'amqp://' || this.url.slice(0, 8) == 'amqps://') {
      return this.url;
    }
    return ['amqp://', this.url].join('');
  },

  processMessage: function(msg) {
    var input = msg.content.toString();
    this.logInfo('Consumer RPC input: ' + input);
    return input + '-OK';
  },

  init : function(options) {
    options = options || {};
    this.connectionRetryInterval  = options.connectionRetryInterval || 500;
    this.url = options.url || 'localhost';
    this.socketOptions = options.socketOptions || {};
    this.queue = options.queue || 'node_rpc_queue';
    this.queueOptions = options.queueOptions || {durable: true};

    if(options.logInfo) {
      this.logInfo = options.logInfo;
    }
    if(options.logError) {
      this.logError = options.logError;
    }

    if(options.processMessage) {
      this.processMessage = options.processMessage;
    }

    return this;
  },

  connect: function () {

    amqp.connect(this.uri(), this.socketOptions).then(function getConnectionSuccess(conn) {

      conn.on('error', function (err) {
        this.logError(err.stack);
        this.reconnect();
      }.bind(this));

      return conn.createChannel().then(function createChannelSuccess(ch) {

        // Capitalize this function as its used with a this binding
        function Reply(msg) {

          // process request
          var response;

          // If this.processMessage is a Q promise, returns the promise.
          // If this.processMessage is not a promise, returns a promise that is fulfilled with value.
          q(this.processMessage(msg))
            .then(function processMessageSuccess(res) {
              response = res;
            })
            .catch(function processMessageError(err) {
              response = err;
            })
            .finally(function() {
              // send response
              ch.sendToQueue(msg.properties.replyTo, new Buffer(response.toString()), {correlationId: msg.properties.correlationId});
              ch.ack(msg);
            });

        }

        return ch.assertQueue(this.queue, this.queueOptions)
          .then(function assertQueueSuccess() {
            ch.prefetch(1);
            return ch.consume(this.queue, Reply.bind(this));
          }.bind(this))
          .then(function consumeSuccess() {
            //logger.info([consumerName, env, 'waiting for RPC requests'].join(' '));
            this.logInfo('Consumer: Waiting for RPC requests on: ' + this.queue);
          }.bind(this));

      }.bind(this));
    }.bind(this))
      .catch(function (error) {
        this.logError('Consumer: AMQP Connect Error: ' + error.stack);
        this.reconnect();
      }.bind(this));
  },

  reconnect: function () {
    this.logInfo('Consumer: Reconnecting');
    setTimeout(this.connect.bind(this), this.connectionRetryInterval);
  },

  run: function () {
    this.connect();
  }
};

exports.create = function(options) {
  return Object.create(rpcConsumerProto).init(options);
};
