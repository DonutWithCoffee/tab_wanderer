'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../core/sold-order-recovery');
test('server overload reduces active order detail concurrency without dropping below one',()=>{
 const controller=create(3);
 assert.equal(controller.concurrency,3);
 assert.equal(controller.onFailure(500),true);
 assert.equal(controller.concurrency,2);
 assert.equal(controller.onFailure(503),true);
 assert.equal(controller.concurrency,1);
 assert.equal(controller.onFailure(429),false);
 assert.equal(controller.concurrency,1);
 assert.equal(controller.serverErrors,3);
});
test('invalid and authentication failures do not count as overload',()=>{
 const controller=create(3);
 assert.equal(controller.onFailure(404),false);
 assert.equal(controller.onFailure(401),false);
 assert.equal(controller.onFailure(undefined),false);
 assert.equal(controller.concurrency,3);
 assert.equal(controller.recoverable({status:401}),false);
 assert.equal(controller.recoverable({status:403}),false);
 assert.equal(controller.recoverable({status:404}),false);
 assert.equal(controller.recoverable({status:500}),true);
});
test('recovery uses bounded cooldowns and starts at single worker',()=>{
 const controller=create();
 assert.equal(controller.retryDelay(0),1500);
 assert.equal(controller.retryDelay(1),4000);
 assert.equal(controller.retryDelay(2),8000);
 assert.equal(create(0).concurrency,1);
});
