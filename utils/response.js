// utils/response.js
module.exports = (success, statusCode, responseMsg, errorMsg = null, response = null) => {
  return {
    success,
    statusCode,
    responseMsg,
    errorMsg,
    response,
  };
};
