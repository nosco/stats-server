var MultiCluster = require('multi-cluster');
var ss = require('../');

var stats = new ss({port:7979});

var apiServer;
apiServer = new MultiCluster(__dirname + '/app.js');
