var os = require('os');
var http = require('http');
var toobusy = require('toobusy-js');

var cluster = require('cluster');

var _singleton = null;
var StatsServer = function(config) {
  // Handle if this is being treated as a function, instead of an object
  if (!(this instanceof StatsServer)) return new StatsServer(config);
  // Work in a singleton style way
  if (_singleton) return _singleton;
  _singleton = this;

  this.config = {
    port: 8181,
    updateInterval: 1000
  };
  config = config || {};
  for (var i in config) {
    this.config[i] = config[i];
  }
  ;

  this.data = {
    aggregated: {},
    apps: {},
    processes: {}
  };

  this.getBasicInfo();

  this.setupMessageListeners();
  this.startHttpServer();
};
module.exports = StatsServer;

StatsServer.prototype.setupMessageListeners = function() {
  if (cluster.isMaster) {
    cluster.on('online', this.startListeningToWorker.bind(this));
    cluster.on('exit', this.stopListeningToWorker.bind(this));
    statsTimer = setInterval(this.requestStats, this.config.updateInterval);
  }
};

StatsServer.prototype.startListeningToWorker = function(worker) {
  worker.on('message', this.messageHandler.bind(this));
  worker.send({
    cmd: 'stats-server:send stats'
  });
};

StatsServer.prototype.stopListeningToWorker = function(worker) {
  worker.removeListener('message', this.messageHandler.bind(this));
};

StatsServer.prototype.requestStats = function() {
  if (cluster.isMaster && cluster.workers) {
    for (var id in cluster.workers) {
      cluster.workers[id].send({
        cmd: 'stats-server:send stats'
      });
    }
  }
};

StatsServer.prototype.messageHandler = function(msg) {
  if (msg.cmd && (msg.cmd == 'stats-server:stats')) {
    cluster.workers[msg.data.id].stats = msg.data;
  }
};

StatsServer.prototype.startHttpServer = function() {
  if (cluster.isMaster) {
    this.server = http.createServer();
    this.server.listen(this.config.port);
    this.server.on('request', this.handleRequest.bind(this));

    console.log('Stats server listening on port ' + this.config.port);
  }
};

StatsServer.prototype.handleRequest = function(request, response) {
  this.aggregateStats();
  var format = 'json';

  if (request.url.match(/format=(html|json)/)) {
    format = request.url.replace(/format=([a-z]+)/, '$1').toLowerCase();
  }
  if (format === 'html') {
    response.setHeader('Content-Type', 'text/html');
    response.write('<html>\n<body>\n');
    for (var key in this.data) {
      response.write(key + ': ' + this.data[key] + '<br />\n');
    }
    response.write('\n</body>\n</html>');
    response.end();
  } else {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(this.data, null, 2));
  }
};

StatsServer.prototype.getBasicInfo = function() {
  // Get basic info on this process
  this.data.uptime = 0;

  this.data.os = {
    type: os.type(),
    release: os.release(),
    platform: os.platform(),
    hostname: os.hostname()
  };

  this.data.system = {
    pid: process.pid,
    architecture: os.arch(),
    node_version: process.version, // Node.js version
    cpus: os.cpus()
  };
};

StatsServer.prototype.aggregateStats = function() {
  var masterMem = process.memoryUsage();

  this.data.processes = {
    '0': {
      memory: process.memoryUsage(),
      id: 0,
      pid: process.pid,
      uptime: process.uptime(),
      filename: process.argv[1],
      lagmax: process.lagmax(),
      lagavg: process.lagavg(),
      activeHandles: process._getActiveHandles().length,
      activeRequests: process._getActiveRequests().length
    }
  };

  this.data.apps = {};

  this.data.aggregated = {
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    usedmem: (os.totalmem() - os.freemem()),
    cpus: os.cpus().length,
    uptime: process.uptime(),
    uptimeavg: 0,
    processes: 1,
    workers: 0,
    rss: masterMem.rss,
    heapTotal: masterMem.heapTotal,
    heapUsed: masterMem.heapUsed,
    lagmax: 0,
    lagavg: [0, 0, 0],
    activeHandles: process._getActiveHandles().length,
    activeRequests: process._getActiveRequests().length
  };

  for (var id in cluster.workers) {
    this.data.aggregated.processes++;

    if (cluster.workers[id].stats != undefined) {
      var workerStats = cluster.workers[id].stats;

      this.data.processes[workerStats.id] = workerStats;

      if (this.data.apps[workerStats.filename] == undefined) {
        this.data.apps[workerStats.filename] = {
          workers: 0,
          uptimeavg: 0,
          rss: 0,
          heapTotal: 0,
          heapUsed: 0,
          lagmax: 0,
          lagavg: [0, 0, 0],
          activeHandles: 0,
          activeRequests: 0
        };
      }

      this.data.apps[workerStats.filename].workers++;
      this.data.apps[workerStats.filename].uptimeavg += workerStats.uptime;
      this.data.apps[workerStats.filename].rss += workerStats.memory.rss;
      this.data.apps[workerStats.filename].heapTotal += workerStats.memory.heapTotal;
      this.data.apps[workerStats.filename].heapUsed += workerStats.memory.heapUsed;

      this.data.apps[workerStats.filename].lagmax = Math.max(this.data.apps[workerStats.filename].lagmax, workerStats.lagmax);

      this.data.apps[workerStats.filename].lagavg[0] += workerStats.lagavg[0];
      this.data.apps[workerStats.filename].lagavg[1] += workerStats.lagavg[1];
      this.data.apps[workerStats.filename].lagavg[2] += workerStats.lagavg[2];

      this.data.apps[workerStats.filename].activeHandles += workerStats.activeHandles;
      this.data.apps[workerStats.filename].activeRequests += workerStats.activeRequests;

      this.data.aggregated.workers++;
      this.data.aggregated.uptimeavg += workerStats.uptime;
      this.data.aggregated.rss += workerStats.memory.rss;
      this.data.aggregated.heapTotal += workerStats.memory.heapTotal;
      this.data.aggregated.heapUsed += workerStats.memory.heapUsed;
      this.data.aggregated.lagmax = Math.max(this.data.aggregated.lagmax, workerStats.lagmax);
      this.data.aggregated.lagavg[0] += workerStats.lagavg[0];
      this.data.aggregated.lagavg[1] += workerStats.lagavg[1];
      this.data.aggregated.lagavg[2] += workerStats.lagavg[2];
      this.data.aggregated.activeHandles += workerStats.activeHandles;
      this.data.aggregated.activeRequests += workerStats.activeRequests;
    }
  }

  this.data.aggregated.uptimeavg = (this.data.aggregated.uptimeavg / this.data.aggregated.workers);
  this.data.aggregated.lagavg[0] = (this.data.aggregated.lagavg[0] / this.data.aggregated.processes);
  this.data.aggregated.lagavg[1] = (this.data.aggregated.lagavg[1] / this.data.aggregated.processes);
  this.data.aggregated.lagavg[2] = (this.data.aggregated.lagavg[2] / this.data.aggregated.processes);

  for (var fileName in this.data.apps) {
    this.data.apps[fileName].uptimeavg = (this.data.apps[fileName].uptimeavg / this.data.apps[fileName].workers);
    this.data.apps[fileName].lagavg[0] = (this.data.apps[fileName].lagavg[0] / this.data.apps[fileName].workers);
    this.data.apps[fileName].lagavg[1] = (this.data.apps[fileName].lagavg[1] / this.data.apps[fileName].workers);
    this.data.apps[fileName].lagavg[2] = (this.data.apps[fileName].lagavg[2] / this.data.apps[fileName].workers);
  }
};

// Setting up running averages of lag
process.lagLog = [];
setInterval(function() {
  process.lagLog.push(toobusy.lag());
  process.lagLog = process.lagLog.slice(-900);
}, 1000);

process.lagmax = function() {
  return Math.max.apply(this, process.lagLog);
};

process.lagavg = function() {
  var lagLogCount = process.lagLog.length;
  if (!lagLogCount) return [0, 0, 0];

  return [
    (process.lagLog.slice(-5).reduce(function(a, b) {
      return a + b;
    }) / Math.min(5, lagLogCount)),
    (process.lagLog.slice(-15).reduce(function(a, b) {
      return a + b;
    }) / Math.min(15, lagLogCount)),
    (process.lagLog.slice(-60).reduce(function(a, b) {
      return a + b;
    }) / Math.min(60, lagLogCount)),
  ];
};


if (cluster.isWorker && cluster.worker) {
  process.on('message', function(msg) {

    if (msg.cmd && (msg.cmd == 'stats-server:send stats')) {
      process.send({
        cmd: 'stats-server:stats',
        data: {
          memory: process.memoryUsage(),
          id: cluster.worker.id,
          pid: process.pid,
          uptime: process.uptime(),
          filename: process.argv[1],
          lagmax: process.lagmax(),
          lagavg: process.lagavg(),
          activeHandles: process._getActiveHandles().length,
          activeRequests: process._getActiveRequests().length
        }
      });

    }
  });
}
