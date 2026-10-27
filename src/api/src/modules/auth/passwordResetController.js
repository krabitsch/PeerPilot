const reset = require('./passwordResetService')
exports.request = async (req, res, next) => {
  try { res.json(await reset.requestReset(req.body?.email)) } catch (err) { next(err) }
}
exports.validate = async (req, res, next) => {
  try { res.json(await reset.validateReset(req.body?.token)) } catch (err) { next(err) }
}
exports.redeem = async (req, res, next) => {
  try { res.json(await reset.resetPassword(req.body?.token, req.body?.password)) } catch (err) { next(err) }
}
