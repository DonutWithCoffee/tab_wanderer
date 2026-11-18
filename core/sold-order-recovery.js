'use strict';
(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports) module.exports=api;
    root.TWSoldOrderRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    function create(initialConcurrency=3){
        let concurrency=Math.max(1,Math.floor(initialConcurrency));
        let serverErrors=0;
        return {
            get concurrency(){return concurrency;},
            get serverErrors(){return serverErrors;},
            onFailure(status){
                if(status!==500&&status!==429&&status!==503) return false;
                serverErrors++;
                const previous=concurrency;
                concurrency=Math.max(1,concurrency-1);
                return concurrency!==previous;
            },
            retryDelay(round){return [1500,4000][round]??8000;},
            recoverable(error){return ![401,403,404].includes(Number(error?.status));}
        };
    }
    return {create};
});
